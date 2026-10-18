/**
 * Server-only helpers untuk OAuth YouTube + upload video dari Google Drive.
 * Jangan import file ini dari komponen React.
 */

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
/** Izin Google Drive diminta terpisah (Brand Account tidak punya Drive).
 *  Butuh scope penuh `drive` agar file bisa dihapus permanen setelah upload. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
/** Baris khusus di tabel akun untuk menyimpan token Google Drive. */
export const DRIVE_ACCOUNT_ID = "__drive__";

function normalizeGoogleCredential(
  raw: string | undefined,
  key: "client_id" | "client_secret",
) {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/placeholder|replace[_ -]?me|your[_ -]?(?:google[_ -]?)?(?:client|secret)/i.test(value)) {
    return undefined;
  }

  const embedded =
    key === "client_id"
      ? value.match(/[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com/)?.[0]
      : value.match(/GOCSPX-[A-Za-z0-9_-]+/)?.[0];
  if (embedded) return embedded;

  try {
    const parsed = JSON.parse(value) as {
      web?: Record<string, unknown>;
      installed?: Record<string, unknown>;
      client_id?: unknown;
      client_secret?: unknown;
    };
    const candidate = parsed.web?.[key] ?? parsed.installed?.[key] ?? parsed[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  } catch {
    // Nilai biasanya berupa string biasa, bukan JSON.
  }

  const withoutPrefix = value.replace(
    new RegExp(`^(?:GOOGLE_OAUTH_)?${key.toUpperCase()}\\s*[=:]\\s*`, "i"),
    "",
  );
  const cleaned = withoutPrefix.replace(/^["']|["']$/g, "").trim();

  // Buang karakter nyasar hasil copy-paste (spasi, slash, tanda kutip di ujung).
  if (key === "client_id") {
    const match = cleaned.match(/[0-9]+-[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com/);
    if (match) return match[0];
  }
  return cleaned.replace(/[\s/\\"']+$/g, "") || undefined;
}

/** Kredensial dari environment (secret proyek). */
export function getGoogleCredentialsFromEnv() {
  const clientId = normalizeGoogleCredential(
    process.env["GOOGLE_OAUTH_CLIENT_ID"],
    "client_id",
  );
  const clientSecret = normalizeGoogleCredential(
    process.env["GOOGLE_OAUTH_CLIENT_SECRET"],
    "client_secret",
  );
  return { clientId, clientSecret };
}

/**
 * Kredensial aktif: yang diisi lewat form di aplikasi (tersimpan di database)
 * diprioritaskan, kalau kosong jatuh ke secret proyek.
 */
export async function getGoogleCredentials() {
  const env = getGoogleCredentialsFromEnv();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("google_client_id, google_client_secret")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .maybeSingle();
    const clientId =
      normalizeGoogleCredential(
        (data as { google_client_id?: string | null } | null)?.google_client_id ?? undefined,
        "client_id",
      ) ?? env.clientId;
    const clientSecret =
      normalizeGoogleCredential(
        (data as { google_client_secret?: string | null } | null)?.google_client_secret ?? undefined,
        "client_secret",
      ) ?? env.clientSecret;
    return { clientId, clientSecret };
  } catch {
    return env;
  }
}

/**
 * Origin publik yang benar-benar dilihat browser (bukan host internal worker),
 * diambil dari header proxy. Dipakai agar redirect_uri saat tukar kode sama
 * persis dengan yang dipakai saat meminta izin.
 */
export function publicOriginFromRequest(request: Request) {
  const h = request.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]?.trim();
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  if (host) return `${proto || (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  return new URL(request.url).origin;
}

/**
 * Halaman aplikasi yang memulai OAuth bisa berbeda dari host callback publik
 * (khususnya di preview Lovable). Referer hanya dipakai sebagai tujuan kembali,
 * dan dibatasi ke localhost atau host Lovable milik project yang sama.
 */
export function returnOriginFromRequest(request: Request, fallbackOrigin: string) {
  const requestedOrigin = new URL(request.url).searchParams.get("return_to");
  if (requestedOrigin) {
    const safeRequestedOrigin = safeOAuthReturnOrigin(requestedOrigin, fallbackOrigin);
    if (safeRequestedOrigin !== fallbackOrigin || requestedOrigin === fallbackOrigin) {
      return safeRequestedOrigin;
    }
  }

  const referer = request.headers.get("referer");
  if (!referer) return fallbackOrigin;
  try {
    const origin = new URL(referer).origin;
    return safeOAuthReturnOrigin(origin, fallbackOrigin);
  } catch {
    return fallbackOrigin;
  }
}

/**
 * Host internal "project--<id>-dev.lovable.app" menolak akses browser (Forbidden),
 * jadi selalu dialihkan ke host preview "id-preview--<id>.lovable.app".
 */
function browsableOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const m = url.hostname.toLowerCase().match(/^project--([0-9a-f-]+)-dev\.lovable\.app$/);
    if (m) return `https://id-preview--${m[1]}.lovable.app`;
    return url.origin;
  } catch {
    return origin;
  }
}

export function safeOAuthReturnOrigin(candidate: string | null | undefined, fallbackOrigin: string) {
  return browsableOrigin(rawSafeOAuthReturnOrigin(candidate, fallbackOrigin));
}

function rawSafeOAuthReturnOrigin(candidate: string | null | undefined, fallbackOrigin: string) {
  if (!candidate) return fallbackOrigin;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1")) {
      return url.origin;
    }
    if (url.protocol !== "https:") return fallbackOrigin;

    const projectId = process.env["LOVABLE_PROJECT_ID"] ?? process.env["__LOVABLE_PROJECT_ID"] ?? "";
    const isLovableHost = hostname.endsWith(".lovable.app") || hostname.endsWith(".lovableproject.com");
    if (isLovableHost && projectId && hostname.includes(projectId.toLowerCase())) {
      return url.origin;
    }
    if (url.origin === fallbackOrigin) return url.origin;
    return fallbackOrigin;
  } catch {
    return fallbackOrigin;
  }
}

/** Redirect URI mengikuti origin publik aplikasi yang memulai proses OAuth. */
export function redirectUriFor(origin?: string | null) {
  const configured = process.env["GOOGLE_OAUTH_REDIRECT_URI"]?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const projectId = process.env["LOVABLE_PROJECT_ID"] ?? process.env["__LOVABLE_PROJECT_ID"];
  if (projectId) {
    return `https://project--${projectId}-dev.lovable.app/api/public/youtube/callback`;
  }
  const safeOrigin = origin && /^https?:\/\/[^\s/]+$/.test(origin) ? origin : "";
  if (!safeOrigin) throw new Error("Alamat aplikasi untuk callback Google tidak valid.");
  return `${safeOrigin}/api/public/youtube/callback`;
}

export function encodeOAuthState(flow: "drive" | "youtube", origin?: string | null) {
  return btoa(JSON.stringify({ f: flow, o: origin || "" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeOAuthState(state?: string | null): { flow: string; origin: string } {
  if (!state) return { flow: "youtube", origin: "" };
  if (state === "drive") return { flow: "drive", origin: "" };
  try {
    const json = JSON.parse(atob(state.replace(/-/g, "+").replace(/_/g, "/")));
    const origin = typeof json?.o === "string" ? json.o : "";
    const safe = /^https?:\/\/[^\s/]+$/.test(origin) ? origin : "";
    return { flow: json?.f === "drive" ? "drive" : "youtube", origin: safe };
  } catch {
    return { flow: "youtube", origin: "" };
  }
}


export function parseDriveFileId(input: string): string | null {
  const url = (input ?? "").trim();
  if (!url) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{10,})/,
    /\/document\/d\/([a-zA-Z0-9_-]{10,})/,
    /\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /\/uc\?[^ ]*id=([a-zA-Z0-9_-]{10,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  // bare ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  // last resort: longest id-looking segment in the URL
  const candidates = url.match(/[a-zA-Z0-9_-]{25,}/g);
  if (candidates?.length) {
    return candidates.sort((a, b) => b.length - a.length)[0];
  }
  return null;
}


export function driveDownloadUrl(fileId: string) {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

export type AccountRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  channel_id: string;
  channel_title: string | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function loadAccounts(): Promise<AccountRow[]> {
  const db = await admin();
  const { data, error } = await db
    .from("youtube_account")
    .select("access_token, refresh_token, expires_at, channel_id, channel_title")
    .neq("channel_id", DRIVE_ACCOUNT_ID)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as AccountRow[] | null) ?? [];
}

async function loadAccountById(channelId: string): Promise<AccountRow | null> {
  const db = await admin();
  const { data } = await db
    .from("youtube_account")
    .select("access_token, refresh_token, expires_at, channel_id, channel_title")
    .eq("channel_id", channelId)
    .maybeSingle();
  return (data as AccountRow | null) ?? null;
}

export async function hasDriveConnection(): Promise<boolean> {
  return Boolean(await loadAccountById(DRIVE_ACCOUNT_ID));
}

export async function loadAccount(channelId?: string | null): Promise<AccountRow | null> {
  const accounts = await loadAccounts();
  if (channelId) {
    // fallback ke akun pertama kalau channel dipilih bukan channel utama akun manapun
    return accounts.find((a) => a.channel_id === channelId) ?? accounts[0] ?? null;
  }
  return accounts[0] ?? null;
}

export async function saveAccount(row: {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  channel_id: string;
  channel_title?: string | null;
}) {
  const db = await admin();
  const { error } = await db
    .from("youtube_account")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "channel_id" });
  if (error) throw error;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchPublicChannelTitle(channelId: string) {
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
  );
  if (!res.ok) return null;
  const xml = await res.text();
  const title = xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  return title ? decodeXmlEntities(title) : null;
}

/** Perbarui nama channel yang sudah tersimpan meskipun token YouTube belum terhubung. */
export async function refreshStoredChannelTitles(force = false) {
  const db = await admin();
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ data: settings }, { data: autopilots }, { data: uploads }] = await Promise.all([
    db.from("channel_settings").select("channel_id, channel_title, updated_at"),
    db.from("channel_autopilot").select("channel_id, channel_title, updated_at"),
    db.from("uploads").select("channel_id, channel_title, updated_at").not("channel_id", "is", null),
  ]);

  const byId = new Map<string, { title: string | null; updatedAt: string | null }>();
  for (const row of [...(settings ?? []), ...(autopilots ?? []), ...(uploads ?? [])]) {
    const channelId = row.channel_id as string | null;
    if (!channelId || channelId === DRIVE_ACCOUNT_ID) continue;
    const prev = byId.get(channelId);
    const updatedAt = (row.updated_at as string | null) ?? null;
    if (!prev || (updatedAt && (!prev.updatedAt || updatedAt > prev.updatedAt))) {
      byId.set(channelId, {
        title: (row.channel_title as string | null) ?? null,
        updatedAt,
      });
    }
  }

  const refreshed = new Map<string, string>();
  for (const [channelId, current] of byId) {
    if (!force && current.updatedAt && current.updatedAt > cutoff) continue;
    const title = await fetchPublicChannelTitle(channelId).catch(() => null);
    if (!title) continue;
    refreshed.set(channelId, title);
    if (title !== current.title) {
      await Promise.all([
        db.from("channel_settings").update({ channel_title: title }).eq("channel_id", channelId),
        db.from("channel_autopilot").update({ channel_title: title }).eq("channel_id", channelId),
        db.from("uploads").update({ channel_title: title }).eq("channel_id", channelId),
        db.from("channel_sub_stats").update({ channel_title: title }).eq("channel_id", channelId),
      ]);
    }
  }
  return refreshed;
}

/**
 * Perbarui nama channel dari YouTube (nama bisa diganti di YouTube Studio).
 * Dibatasi maks sekali per 10 menit per channel supaya hemat kuota.
 */
export async function refreshChannelTitles(accounts: AccountRow[], force = false): Promise<AccountRow[]> {
  const db = await admin();
  const { data: meta } = await db
    .from("youtube_account")
    .select("channel_id, updated_at")
    .in("channel_id", accounts.map((a) => a.channel_id));
  const updatedAt = new Map((meta ?? []).map((m) => [m.channel_id, new Date(m.updated_at).getTime()]));
  const cutoff = Date.now() - 10 * 60_000;
  return Promise.all(
    accounts.map(async (a) => {
      if (!force && (updatedAt.get(a.channel_id) ?? 0) > cutoff) return a;
      try {
        const token = await getValidAccessToken(a.channel_id);
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(a.channel_id)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return a;
        const json = (await res.json()) as { items?: Array<{ snippet: { title: string } }> };
        const title = json.items?.[0]?.snippet.title;
        await db
          .from("youtube_account")
          .update({ channel_title: title ?? a.channel_title, updated_at: new Date().toISOString() })
          .eq("channel_id", a.channel_id);
        if (title && title !== a.channel_title) {
          await Promise.all([
            db.from("channel_settings").update({ channel_title: title }).eq("channel_id", a.channel_id),
            db.from("channel_autopilot").update({ channel_title: title }).eq("channel_id", a.channel_id),
            db.from("uploads").update({ channel_title: title }).eq("channel_id", a.channel_id),
            db.from("channel_sub_stats").update({ channel_title: title }).eq("channel_id", a.channel_id),
          ]);
          return { ...a, channel_title: title };
        }
        return a;
      } catch {
        return a;
      }
    }),
  );
}

export async function deleteAccount(channelId?: string | null) {
  const db = await admin();
  if (channelId) {
    await db.from("youtube_account").delete().eq("channel_id", channelId);
    return;
  }
  await db.from("youtube_account").delete().neq("channel_id", DRIVE_ACCOUNT_ID);
}

export async function exchangeCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = await getGoogleCredentials();
  if (!clientId || !clientSecret) throw new Error("Kredensial Google OAuth belum diatur.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Token exchange gagal [${res.status}]: ${body}`);
  return JSON.parse(body) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = await getGoogleCredentials();
  if (!clientId || !clientSecret) throw new Error("Kredensial Google OAuth belum diatur.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Refresh token gagal [${res.status}]: ${body}`);
  return JSON.parse(body) as { access_token: string; expires_in: number };
}

async function validTokenFor(account: AccountRow): Promise<string> {
  const expiresAt = new Date(account.expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) return account.access_token;

  const refreshed = await refreshAccessToken(account.refresh_token);
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await saveAccount({
    access_token: refreshed.access_token,
    refresh_token: account.refresh_token,
    expires_at: newExpiry,
    channel_id: account.channel_id,
    channel_title: account.channel_title,
  });
  return refreshed.access_token;
}

/** Ambil access token yang valid, refresh otomatis kalau sudah mau habis. */
export async function getValidAccessToken(channelId?: string | null): Promise<string> {
  const account = await loadAccount(channelId);
  if (!account)
    throw new Error(
      "Belum ada akun Google yang terhubung. Klik \"Hubungkan Google Drive\" / \"Hubungkan YouTube\" di halaman utama dulu.",
    );
  return validTokenFor(account);
}

/**
 * Token untuk operasi Google Drive: pakai koneksi Drive khusus bila ada,
 * kalau belum ada baru jatuh ke token channel (biasanya tanpa izin Drive).
 */
export async function getDriveAccessToken(channelId?: string | null): Promise<string> {
  const drive = await loadAccountById(DRIVE_ACCOUNT_ID);
  if (drive) return validTokenFor(drive);
  return getValidAccessToken(channelId ?? null);
}

export async function listChannels(accessToken: string) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`Gagal mengambil daftar channel [${res.status}]: ${body}`);
  const json = JSON.parse(body) as {
    items?: Array<{ id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }>;
  };
  return (json.items ?? []).map((i) => ({
    id: i.id,
    title: i.snippet.title,
    thumbnail: i.snippet.thumbnails?.default?.url ?? null,
  }));
}

export async function fetchChannelInfo(accessToken: string) {
  const empty = { id: null as string | null, title: null as string | null };
  const fetchChannels = async (query: string) => {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&${query}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const body = await res.text();
    if (!res.ok) {
      let reason = "";
      try {
        const parsed = JSON.parse(body) as {
          error?: { message?: string; errors?: Array<{ reason?: string }> };
        };
        reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.message ?? "";
      } catch {
        reason = body;
      }
      if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason)) {
        throw new Error(
          "YouTube Data API v3 belum diaktifkan pada project Google Cloud dari Client ID ini. Buka Google Cloud Console → APIs & Services → Library → aktifkan \"YouTube Data API v3\", tunggu beberapa menit, lalu coba hubungkan channel lagi.",
        );
      }
      if (/quotaExceeded|dailyLimitExceeded/i.test(reason)) {
        throw new Error(
          "Kuota harian YouTube untuk aplikasi ini sudah habis. Coba hubungkan lagi setelah kuota Google diperbarui pukul 14.00 WIB (15.00 WITA), atau naikkan kuota YouTube Data API di Google Cloud.",
        );
      }
      throw new Error(
        `YouTube menolak permintaan channel [${res.status}]${reason ? `: ${reason.slice(0, 220)}` : "."}`,
      );
    }
    const json = JSON.parse(body) as {
      items?: Array<{ id: string; snippet: { title: string } }>;
    };
    return json.items ?? [];
  };

  // Brand Account yang dipilih di pemilih akun Google biasanya muncul via mine=true.
  const mine = await fetchChannels("mine=true");
  if (mine[0]) return { id: mine[0].id, title: mine[0].snippet.title };

  // Fallback: sebagian Brand Account hanya terlihat lewat managedByMe=true.
  const managed = await fetchChannels("managedByMe=true&maxResults=50");
  if (managed.length === 1) return { id: managed[0]!.id, title: managed[0]!.snippet.title };
  return empty;
};

/** Semua channel yang bisa diakses token ini (akun sendiri + Brand Account yang dikelola). */
export async function fetchAllOwnedChannels(accessToken: string) {
  const get = async (query: string) => {
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&${query}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as {
        items?: Array<{ id: string; snippet: { title: string } }>;
      };
      return json.items ?? [];
    } catch {
      return [];
    }
  };
  const [mine, managed] = await Promise.all([
    get("mine=true&maxResults=50"),
    get("managedByMe=true&maxResults=50"),
  ]);
  const map = new Map<string, string>();
  for (const item of [...mine, ...managed]) map.set(item.id, item.snippet.title);
  return Array.from(map, ([id, title]) => ({ id, title }));
}


/** Kategori video terbaru di channel (biasanya upload manual). Fallback: Education. */
export async function getChannelCategory(accessToken: string): Promise<string> {
  try {
    const h = { Authorization: `Bearer ${accessToken}` };
    const ch = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
      { headers: h },
    ).then((r) => r.json() as Promise<{ items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>);
    const playlist = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlist) return "27";
    const pl = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=5&playlistId=${playlist}`,
      { headers: h },
    ).then((r) => r.json() as Promise<{ items?: Array<{ contentDetails?: { videoId?: string } }> }>);
    const ids = (pl.items ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean);
    if (!ids.length) return "27";
    const v = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(",")}`,
      { headers: h },
    ).then((r) => r.json() as Promise<{ items?: Array<{ snippet?: { categoryId?: string } }> }>);
    const counts = new Map<string, number>();
    for (const it of v.items ?? []) {
      const c = it.snippet?.categoryId;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "27";
  } catch {
    return "27";
  }
}

/** Unduh dari Drive (link publik) lalu upload ke YouTube via resumable upload. */
export async function uploadDriveVideoToYouTube(opts: {
  fileId: string;
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  channelId?: string | null;
  kind?: "video" | "reels";
  tags?: string[];
}) {
  const accessToken = await getValidAccessToken(opts.channelId ?? null);

  let driveRes = await fetch(driveDownloadUrl(opts.fileId));
  let contentType = driveRes.headers.get("content-type") ?? "";
  if (!driveRes.ok || !driveRes.body || contentType.includes("text/html")) {
    // Fallback: unduh lewat token Google Drive akun terhubung (file privat / butuh izin).
    const { fetchDriveFileWithToken } = await import("./drive.server");
    const driveToken = await getDriveAccessToken(opts.channelId ?? null);
    const viaGateway = await fetchDriveFileWithToken(opts.fileId, driveToken);
    if (!viaGateway.ok || !viaGateway.body) {
      const detail = await viaGateway.text().catch(() => "");
      throw new Error(
        `Gagal mengunduh file dari Google Drive [${viaGateway.status}]. Pastikan file dibagikan publik atau dapat diakses akun Drive yang terhubung. ${detail.slice(0, 300)}`,
      );
    }
    driveRes = viaGateway;
    contentType = viaGateway.headers.get("content-type") ?? "video/*";
  }
  const contentLength = driveRes.headers.get("content-length");

  // Privasi langsung sesuai permintaan. Menahan video sebagai "private" dulu
  // berisiko tersangkut (worker berhenti sebelum sempat publish) sehingga video
  // tidak pernah tayang. Perbaikan otomatis dijalankan lewat cron.
  const initialPrivacy = opts.privacy;
  const categoryId = await getChannelCategory(accessToken);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": contentType || "video/*",
        ...(contentLength ? { "X-Upload-Content-Length": contentLength } : {}),
      },
      body: JSON.stringify({
        snippet: {
          title: opts.title,
          description: opts.description,
          // Tag relevan saja (maks 12). Tag generik memicu sinyal spam.
          tags: (opts.tags ?? []).slice(0, 12),
          // Kategori disamakan dengan video terbaru channel (upload manual),
          // supaya YouTube menyalurkan ke audiens yang sama.
          categoryId,
          defaultAudioLanguage: "id",
          ...(opts.channelId ? { channelId: opts.channelId } : {}),
        },
        status: {
          privacyStatus: initialPrivacy,
          selfDeclaredMadeForKids: false,
          embeddable: true,
          publicStatsViewable: true,
        },
      }),
    },
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Inisialisasi upload YouTube gagal [${initRes.status}]: ${err}`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube tidak mengembalikan URL upload.");

  const bodyInit: RequestInit = {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "video/*",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    },
    body: contentLength ? driveRes.body : await driveRes.arrayBuffer(),
    // @ts-expect-error duplex diperlukan saat body berupa stream
    duplex: "half",
  };

  const uploadRes = await fetch(uploadUrl, bodyInit);
  const uploadBody = await uploadRes.text();
  if (!uploadRes.ok) {
    throw new Error(`Upload ke YouTube gagal [${uploadRes.status}]: ${uploadBody}`);
  }
  const video = JSON.parse(uploadBody) as { id: string };


  return video.id;
}

/** Cek apakah video terkunci private oleh YouTube padahal diminta publik/unlisted. */
export async function checkVideoLocked(
  videoId: string,
  requested: string,
  channelId?: string | null,
): Promise<string | null> {
  if (requested === "private") return null;
  try {
    const token = await getValidAccessToken(channelId);
    const actual = await getVideoPrivacy(videoId, token);
    if (actual === "private") {
      return "Peringatan: YouTube mengunci video ini jadi PRIVATE (project Google API belum diaudit). Penonton tidak bisa melihatnya. Ajukan audit di https://support.google.com/youtube/contact/yt_api_form atau ubah ke publik manual di YouTube Studio.";
    }
  } catch {
    /* abaikan */
  }
  return null;
}

/** Ambil status privasi video di YouTube. */
async function getVideoPrivacy(videoId: string, accessToken: string) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=status&id=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    items?: Array<{ status?: { privacyStatus?: string } }>;
  };
  return json.items?.[0]?.status?.privacyStatus ?? null;
}


/** Ubah privasi video yang sudah terunggah. */
export async function setVideoPrivacy(
  videoId: string,
  privacy: "private" | "unlisted" | "public",
  accessToken: string,
) {
  const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=status", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: videoId,
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: false,
        embeddable: true,
        publicStatsViewable: true,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gagal mengubah privasi video [${res.status}]: ${body}`);
  }
}

/**
 * Perbaikan otomatis: video yang seharusnya publik tapi masih private
 * (mis. proses publish sebelumnya terputus) dikembalikan ke publik.
 */
export async function republishStuckPrivateVideos(limit = 25) {
  const db = await admin();
  const { data } = await db
    .from("uploads")
    .select("id, video_id, channel_id, privacy, status")
    .eq("status", "done")
    .eq("privacy", "public")
    .not("video_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Array<{
    id: string;
    video_id: string;
    channel_id: string | null;
  }>;

  let fixed = 0;
  for (const row of rows) {
    try {
      const token = await getValidAccessToken(row.channel_id);
      const current = await getVideoPrivacy(row.video_id, token);
      if (current === "private") {
        await setVideoPrivacy(row.video_id, "public", token);
        fixed += 1;
      }
    } catch {
      // lewati video yang gagal diperiksa
    }
  }
  return { checked: rows.length, fixed };
}

