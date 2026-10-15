import { createServerFn } from "@tanstack/react-start";
import { validateUploadInput } from "./upload-input";

export const getYoutubeStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getGoogleCredentials, loadAccounts, hasDriveConnection, redirectUriFor, publicOriginFromRequest, refreshStoredChannelTitles } = await import("./youtube.server");
  const { getRequest } = await import("@tanstack/react-start/server");
  const redirectUri = redirectUriFor(publicOriginFromRequest(getRequest()));
  const storedTitles = await refreshStoredChannelTitles().catch(() => new Map<string, string>());

  const { clientId, clientSecret } = await getGoogleCredentials();
  const configured = Boolean(clientId && clientSecret);
  if (!configured)
    return {
      configured: false,
      connected: false,
      driveConnected: false,
      channelTitle: null,
      accounts: [],
      redirectUri,
    };
  let accounts: Awaited<ReturnType<typeof loadAccounts>> = [];
  try {
    accounts = await loadAccounts();
  } catch (error) {
    // PGRST303 "JWT issued at future" = selisih jam antara server dan backend.
    // Coba sekali lagi setelah jeda singkat, lalu degradasi dengan aman.
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
    if (/issued at future/i.test(message)) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        accounts = await loadAccounts();
      } catch {
        return {
          configured: true,
          connected: false,
          driveConnected: false,
          channelTitle: null,
          accounts: [],
          redirectUri,
        };
      }
    } else {
      throw error;
    }
  }
  try {
    const { refreshChannelTitles } = await import("./youtube.server");
    accounts = await refreshChannelTitles(accounts);
  } catch {
    // tetap pakai nama tersimpan
  }
  let driveConnected = false;
  try {
    driveConnected = await hasDriveConnection();
  } catch {
    driveConnected = false;
  }
  return {
    configured: true,
    connected: accounts.length > 0,
    driveConnected,
    channelTitle: accounts[0]?.channel_title ?? null,
    accounts: accounts.map((a) => ({ id: a.channel_id, title: a.channel_title })),
    redirectUri,
  };
});

export const getYoutubeAuthUrl = createServerFn({ method: "POST" })
  .inputValidator((data?: { origin?: string }) => ({ origin: data?.origin ?? "" }))
  .handler(async ({ data }) => {
  const { getGoogleCredentials, redirectUriFor, YOUTUBE_SCOPE, publicOriginFromRequest, encodeOAuthState } = await import("./youtube.server");
  const { getRequest } = await import("@tanstack/react-start/server");
  const origin = data.origin || publicOriginFromRequest(getRequest());
  const { clientId, clientSecret } = await getGoogleCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Kredensial Google OAuth belum diatur.");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(origin),
    response_type: "code",
    // Brand Account YouTube tidak memiliki layanan Google Drive. Meminta scope
    // Drive di alur yang sama membuat pemilih channel berakhir di
    // accounts.google.com/info/servicerestricted setelah Brand Account dipilih.
    scope: `${YOUTUBE_SCOPE} https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.readonly`,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: encodeOAuthState("youtube", origin),
  });

  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
});

/**
 * Login terpisah khusus izin Google Drive (pakai akun Google biasa, bukan
 * Brand Account) supaya daftar folder & unduhan file tetap bisa dibaca.
 */
export const getDriveAuthUrl = createServerFn({ method: "POST" })
  .inputValidator((data?: { origin?: string }) => ({ origin: data?.origin ?? "" }))
  .handler(async ({ data }) => {
  const { getGoogleCredentials, redirectUriFor, DRIVE_SCOPE, publicOriginFromRequest, encodeOAuthState } = await import("./youtube.server");
  const { getRequest } = await import("@tanstack/react-start/server");
  const origin = data.origin || publicOriginFromRequest(getRequest());
  const { clientId, clientSecret } = await getGoogleCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Kredensial Google OAuth belum diatur.");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(origin),
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    state: encodeOAuthState("drive", origin),
  });

  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  });

export const disconnectDrive = createServerFn({ method: "POST" }).handler(async () => {
  const { deleteAccount, DRIVE_ACCOUNT_ID } = await import("./youtube.server");
  await deleteAccount(DRIVE_ACCOUNT_ID);
  return { ok: true };
});

export const listYoutubeChannels = createServerFn({ method: "GET" }).handler(async () => {
  const { getValidAccessToken, listChannels, loadAccounts, refreshStoredChannelTitles } = await import("./youtube.server");
  const accounts = await loadAccounts();
  const storedTitles = await refreshStoredChannelTitles().catch(() => new Map<string, string>());
  const results: Array<{ id: string; title: string; thumbnail: string | null }> = [];
  // Semua akun diproses paralel dengan batas waktu per akun — satu token macet
  // tidak boleh menggantung seluruh daftar (Langkah 1 jadi "Memuat channel…" terus).
  const settled = await Promise.all(
    accounts.map(async (account) => {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 8_000),
      );
      try {
        const token = await Promise.race([getValidAccessToken(account.channel_id), timeout]);
        return await Promise.race([listChannels(token), timeout]);
      } catch {
        return null;
      }
    }),
  );
  settled.forEach((channels, i) => {
    const account = accounts[i]!;
    if (!channels) {
      // token channel ini bermasalah — tetap tampilkan data dasar dari DB
      if (!results.some((r) => r.id === account.channel_id)) {
        results.push({
          id: account.channel_id,
          title: storedTitles.get(account.channel_id) ?? account.channel_title ?? account.channel_id,
          thumbnail: null,
        });
      }
      return;
    }
    for (const c of channels) {
      if (!results.some((r) => r.id === c.id)) {
        results.push({ ...c, title: storedTitles.get(c.id) ?? c.title });
      }
    }
  });
  return results;
});

/** Status kredensial Google OAuth: Client ID ditampilkan, secret hanya ditandai terisi. */
export const getGoogleOAuthSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { getGoogleCredentials, getGoogleCredentialsFromEnv } = await import("./youtube.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("google_client_id, google_client_secret")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .maybeSingle();
  const row = (data ?? null) as
    | { google_client_id?: string | null; google_client_secret?: string | null }
    | null;
  const active = await getGoogleCredentials();
  const env = getGoogleCredentialsFromEnv();
  return {
    clientId: (row?.google_client_id ?? "").trim(),
    hasClientSecret: Boolean((row?.google_client_secret ?? "").trim()),
    usingEnv:
      !((row?.google_client_id ?? "").trim() && (row?.google_client_secret ?? "").trim()) &&
      Boolean(env.clientId && env.clientSecret),
    configured: Boolean(active.clientId && active.clientSecret),
  };
});

export const saveGoogleOAuthSettings = createServerFn({ method: "POST" })
  .inputValidator((input: { clientId?: string; clientSecret?: string }) => ({
    clientId: (input.clientId ?? "").trim(),
    clientSecret: (input.clientSecret ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      id: "00000000-0000-0000-0000-000000000001",
      updated_at: new Date().toISOString(),
    };
    // Client ID selalu ditulis (boleh dikosongkan agar kembali memakai secret proyek).
    patch["google_client_id"] = data.clientId || null;
    // Secret hanya ditimpa kalau diisi; kosong berarti "biarkan yang lama".
    if (data.clientSecret) patch["google_client_secret"] = data.clientSecret;
    if (!data.clientId) patch["google_client_secret"] = null;

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(patch as never, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select(
      "default_channel_id, default_channel_title, default_kind, default_privacy, default_description, slot_times, timezone",
    )
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .maybeSingle();
  return {
    channelId: data?.default_channel_id ?? "",
    channelTitle: data?.default_channel_title ?? "",
    kind: data?.default_kind === "reels" ? "reels" : "video",
    privacy: data?.default_privacy ?? "public",
    description: data?.default_description ?? "",
    slotTimes: data?.slot_times ?? "07:00,12:00,19:00",
    timezone: data?.timezone ?? "Asia/Jakarta",
  };
});

export const saveAppSettings = createServerFn({ method: "POST" })
  .inputValidator((input: {
    channelId?: string | null;
    channelTitle?: string | null;
    kind?: string;
    privacy?: string;
    description?: string;
    slotTimes?: string;
    timezone?: string;
  }) => ({
    channelId: input.channelId?.trim() || null,
    channelTitle: input.channelTitle?.trim() || null,
    kind: input.kind === "reels" ? "reels" : "video",
    privacy: ["private", "unlisted", "public"].includes(input.privacy ?? "")
      ? input.privacy!
      : "public",
    description: (input.description ?? "").slice(0, 4500),
    slotTimes: input.slotTimes?.trim() || "07:00,12:00,19:00",
    timezone: input.timezone?.trim() || "Asia/Jakarta",
  }))
  .handler(async ({ data }) => {
    const { parseSlotTimes } = await import("./schedule.server");
    parseSlotTimes(data.slotTimes); // validasi format HH:MM
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert(
      {
        id: "00000000-0000-0000-0000-000000000001",
        default_channel_id: data.channelId,
        default_channel_title: data.channelTitle,
        default_kind: data.kind,
        default_privacy: data.privacy,
        default_description: data.description,
        slot_times: data.slotTimes,
        timezone: data.timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const disconnectYoutube = createServerFn({ method: "POST" })
  .inputValidator((input?: { channelId?: string | null }) => ({
    channelId: input?.channelId?.trim() || null,
  }))
  .handler(async ({ data }) => {
    const { deleteAccount } = await import("./youtube.server");
    await deleteAccount(data.channelId);
    return { ok: true };
  });

export const listUploads = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("uploads")
    .select(
      "id, title, drive_url, drive_file_id, status, video_id, error, created_at, scheduled_at, published_at, kind, channel_title, channel_id",
    )
    .order("created_at", { ascending: false })
    .limit(1000);
  return data ?? [];
});

export type YoutubeHistoryItem = {
  videoId: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
};

/** Ambil riwayat upload langsung dari playlist uploads channel di YouTube. */
export const fetchChannelUploadHistory = createServerFn({ method: "POST" })
  .inputValidator((input?: { channelId?: string | null }) => ({
    channelId: input?.channelId?.trim() || null,
  }))
  .handler(async ({ data }) => {
    const { getValidAccessToken } = await import("./youtube.server");
    const token = await getValidAccessToken(data.channelId);
    const headers = { Authorization: `Bearer ${token}` };

    // 1) Cari playlist "uploads" milik channel.
    const chUrl = data.channelId
      ? `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(data.channelId)}`
      : "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true";
    const ch = (await fetch(chUrl, { headers }).then((r) => r.json())) as {
      items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
      error?: { message?: string };
    };
    const playlist = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlist)
      throw new Error(
        `Playlist uploads tidak ditemukan untuk channel ini${ch.error ? `: ${ch.error.message}` : "."}`,
      );

    // 2) Ambil daftar video dari playlist (maksimal 100 terbaru).
    const MAX = 100;
    const ids: string[] = [];
    let pageToken = "";
    while (ids.length < MAX) {
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlist}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(
          `Gagal membaca playlist uploads [${res.status}]${body?.error?.message ? `: ${body.error.message}` : "."}`,
        );
      }
      const json = (await res.json()) as {
        items?: Array<{ contentDetails?: { videoId?: string } }>;
        nextPageToken?: string;
      };
      for (const it of json.items ?? []) {
        if (it.contentDetails?.videoId && ids.length < MAX) ids.push(it.contentDetails.videoId);
      }
      pageToken = json.nextPageToken ?? "";
      if (!pageToken) break;
    }
    if (ids.length === 0) return { items: [] as YoutubeHistoryItem[] };

    // 3) Ambil judul, tanggal, dan statistik per 50 video.
    const items: YoutubeHistoryItem[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${batch.join(",")}`,
        { headers },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(
          `Gagal membaca detail video [${res.status}]${body?.error?.message ? `: ${body.error.message}` : "."}`,
        );
      }
      const json = (await res.json()) as {
        items?: Array<{
          id: string;
          snippet?: { title?: string; publishedAt?: string };
          statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        }>;
      };
      for (const v of json.items ?? []) {
        if (!v.id) continue;
        items.push({
          videoId: v.id,
          title: v.snippet?.title ?? v.id,
          publishedAt: v.snippet?.publishedAt ?? "",
          views: Number(v.statistics?.viewCount ?? 0),
          likes: Number(v.statistics?.likeCount ?? 0),
          comments: Number(v.statistics?.commentCount ?? 0),
        });
      }
    }
    items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    // Simpan permanen di database: riwayat tetap ada sampai dihapus pengguna.
    if (items.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin.from("video_stats").upsert(
        items.map((v) => ({
          video_id: v.videoId,
          channel_id: data.channelId,
          title: v.title,
          published_at: v.publishedAt || null,
          views: v.views,
          likes: v.likes,
          comments: v.comments,
          checked_at: now,
        })),
        { onConflict: "video_id" },
      );
      if (error) console.error("[history save]", error.message);
    }
    return { items };
  });

/** Riwayat tersimpan permanen di database, dikelompokkan per channel. */
export const listSavedChannelHistory = createServerFn({ method: "POST" })
  .inputValidator((input: { channelIds: string[] }) => ({
    channelIds: (input?.channelIds ?? []).map(String).filter(Boolean).slice(0, 100),
  }))
  .handler(async ({ data }) => {
    const out: Record<string, YoutubeHistoryItem[]> = {};
    if (data.channelIds.length === 0) return out;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("video_stats")
      .select("video_id, channel_id, title, published_at, views, likes, comments")
      .in("channel_id", data.channelIds)
      .order("published_at", { ascending: false })
      .limit(5000);
    for (const r of rows ?? []) {
      if (!r.channel_id) continue;
      (out[r.channel_id] ??= []).push({
        videoId: r.video_id,
        title: r.title ?? r.video_id,
        publishedAt: r.published_at ?? "",
        views: Number(r.views),
        likes: Number(r.likes),
        comments: Number(r.comments),
      });
    }
    return out;
  });


export const uploadFromDrive = createServerFn({ method: "POST" })
  .inputValidator(validateUploadInput)
  .handler(async ({ data }) => {
    const { decorateForKind, runUploadRow, assertNotDuplicate } = await import("./upload-runner.server");
    const { parseDriveFileId } = await import("./youtube.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { title, description } = decorateForKind({
      driveUrl: data.driveUrl,
      title: data.title,
      description: data.description,
      privacy: data.privacy,
      channelId: data.channelId,
      kind: data.kind,
    });

    await assertNotDuplicate({
      driveFileId: parseDriveFileId(data.driveUrl),
      title,
      channelId: data.channelId,
    });

    const { data: row } = await supabaseAdmin
      .from("uploads")
      .insert({
        drive_url: data.driveUrl,
        drive_file_id: parseDriveFileId(data.driveUrl),
        title,
        description,
        privacy: data.privacy,
        status: "uploading",
        kind: data.kind,
        channel_id: data.channelId,
        channel_title: data.channelTitle,
      })
      .select("id")
      .single();

    if (!row?.id) throw new Error("Gagal membuat catatan upload.");

    return await runUploadRow(row.id, {
      driveUrl: data.driveUrl,
      title,
      description,
      privacy: data.privacy,
      channelId: data.channelId,
      kind: data.kind,
    });
  });

/** Simpan pekerjaan upload untuk dijalankan pada waktu tertentu. */
export const scheduleUpload = createServerFn({ method: "POST" })
  .inputValidator(validateUploadInput)
  .handler(async ({ data }) => {
    if (!data.scheduledAt) throw new Error("Waktu jadwal wajib diisi.");
    const { decorateForKind, assertNotDuplicate } = await import("./upload-runner.server");
    const { parseDriveFileId } = await import("./youtube.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!parseDriveFileId(data.driveUrl)) throw new Error("Link Google Drive tidak valid.");

    const { title, description } = decorateForKind({
      driveUrl: data.driveUrl,
      title: data.title,
      description: data.description,
      privacy: data.privacy,
      channelId: data.channelId,
      kind: data.kind,
    });

    await assertNotDuplicate({
      driveFileId: parseDriveFileId(data.driveUrl),
      title,
      channelId: data.channelId,
    });

    const { data: row, error } = await supabaseAdmin
      .from("uploads")
      .insert({
        drive_url: data.driveUrl,
        drive_file_id: parseDriveFileId(data.driveUrl),
        title,
        description,
        privacy: data.privacy,
        status: "scheduled",
        scheduled_at: data.scheduledAt,
        kind: data.kind,
        channel_id: data.channelId,
        channel_title: data.channelTitle,
      })
      .select("id, scheduled_at")
      .single();
    if (error) throw new Error(error.message);
    return { id: row?.id ?? null, scheduledAt: row?.scheduled_at ?? data.scheduledAt };
  });

/** Batalkan satu jadwal yang belum berjalan. */
export const cancelScheduledUpload = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("ID jadwal wajib diisi.");
    return { id: input.id };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("uploads")
      .delete()
      .eq("id", data.id)
      .eq("status", "scheduled");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Hapus semua jadwal yang belum berjalan (opsional: hanya satu channel). */
export const cancelAllScheduledUploads = createServerFn({ method: "POST" })
  .inputValidator((input?: { channelId?: string | null }) => ({
    channelId: input?.channelId ?? null,
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("uploads").delete().eq("status", "scheduled");
    if (data.channelId) q = q.eq("channel_id", data.channelId);
    const { data: rows, error } = await q.select("id");
    if (error) throw new Error(error.message);
    return { deleted: rows?.length ?? 0 };
  });

/** Posting sekarang: jalankan satu jadwal langsung tanpa menunggu waktunya. */
export const postScheduledNow = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("ID jadwal wajib diisi.");
    return { id: input.id };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runUploadRow } = await import("./upload-runner.server");

    // Klaim baris agar cron tidak mengunggah video yang sama bersamaan.
    const { data: claimed, error } = await supabaseAdmin
      .from("uploads")
      .update({ status: "uploading", error: null, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "scheduled")
      .select("id, title, description, drive_url, privacy, channel_id, kind");
    if (error) throw new Error(error.message);
    const row = claimed?.[0];
    if (!row) throw new Error("Jadwal ini sudah berjalan atau tidak ditemukan.");

    const result = await runUploadRow(
      row.id,
      {
        driveUrl: row.drive_url,
        title: row.title,
        description: row.description ?? "",
        privacy: (row.privacy as "private" | "unlisted" | "public") ?? "private",
        channelId: row.channel_id ?? null,
        kind: row.kind === "reels" ? "reels" : "video",
      },
      true,
    );

    // Setelah berhasil diposting, atur ulang sisa jadwal channel ini agar
    // urutannya rapat lagi mulai dari slot terdekat di depan.
    if (result?.videoId && row.channel_id) {
      try {
        await rescheduleChannelQueue(supabaseAdmin, row.channel_id);
      } catch (e) {
        console.error("Gagal mengatur ulang jadwal:", e);
      }
    }

    return result;
  });

/** Atur ulang scheduled_at semua antrean "scheduled" sebuah channel sesuai urutan & slot jam. */
async function rescheduleChannelQueue(
  supabaseAdmin: any,
  channelId: string,
): Promise<void> {
  const { buildSlotSchedule } = await import("./schedule.server");

  const [{ data: settings }, { data: insight }] = await Promise.all([
    supabaseAdmin
      .from("channel_settings")
      .select("slot_times, timezone")
      .eq("channel_id", channelId)
      .maybeSingle(),
    supabaseAdmin
      .from("channel_insights")
      .select("best_hours")
      .eq("channel_id", channelId)
      .maybeSingle(),
  ]);
  // Jam tayang mengikuti hasil evaluasi terbaru bila ada.
  const slotTimes: string =
    insight?.best_hours?.trim() || settings?.slot_times || "07:00,12:00,19:00";
  const timeZone: string = settings?.timezone ?? "Asia/Jakarta";

  const { data: queue, error } = await supabaseAdmin
    .from("uploads")
    .select("id, scheduled_at")
    .eq("channel_id", channelId)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true });
  if (error || !queue || queue.length === 0) return;

  // Rapatkan hanya ke slot hari ini; sisa antrean dijadwalkan besok oleh
  // autopilot berdasarkan evaluasi terbaru.
  const { localDate } = await import("./daily-report.server");
  const today = localDate(new Date(), timeZone);
  const times = buildSlotSchedule({ count: queue.length, slotTimes, timeZone }).filter(
    (d) => localDate(d, timeZone) === today,
  );
  if (times.length === 0) return;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < queue.length; i += 1) {
    const next = times[i]!.toISOString();
    if (queue[i]!.scheduled_at === next) continue;
    await supabaseAdmin
      .from("uploads")
      .update({ scheduled_at: next, updated_at: nowIso })
      .eq("id", queue[i]!.id)
      .eq("status", "scheduled");
  }
}

/** Jalankan semua jadwal yang sudah jatuh tempo. */
export const runDueUploads = createServerFn({ method: "POST" }).handler(async () => {
  const { processDueUploads } = await import("./upload-runner.server");
  return await processDueUploads();
});


/** Hapus video yang sudah terupload: hapus dari YouTube + statistik + riwayat. */
export const deleteUploadedVideo = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("ID upload wajib diisi.");
    return { id: input.id };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getValidAccessToken } = await import("./youtube.server");

    const { data: row, error: loadError } = await supabaseAdmin
      .from("uploads")
      .select("id, video_id, channel_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!row) throw new Error("Riwayat upload tidak ditemukan.");

    if (row.video_id) {
      const token = await getValidAccessToken(row.channel_id);
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?id=${row.video_id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok && res.status !== 404) {
        const body = await res.text();
        if (res.status === 403 && /insufficient|SCOPE/i.test(body)) {
          throw new Error(
            "Izin hapus video belum diberikan untuk channel ini. Klik \"Tambah channel lain\", login ulang dengan akun channel ini dan setujui semua izin, lalu coba Hapus lagi.",
          );
        }
        throw new Error(`YouTube menolak hapus video [${res.status}]: ${body}`);
      }
      await supabaseAdmin.from("video_stats").delete().eq("video_id", row.video_id);
    }

    const { error } = await supabaseAdmin.from("uploads").delete().eq("id", row.id);
    if (error) throw new Error(error.message);
    return { ok: true, videoDeleted: Boolean(row.video_id) };
  });

export const deleteChannelVideo = createServerFn({ method: "POST" })
  .inputValidator((input: { channelId: string; videoId: string }) => ({
    channelId: String(input.channelId).trim(),
    videoId: String(input.videoId).trim(),
  }))
  .handler(async ({ data }) => {
    if (!data.videoId) throw new Error("videoId kosong");
    const { getValidAccessToken } = await import("./youtube.server");
    const token = await getValidAccessToken(data.channelId);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(data.videoId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok && res.status !== 404) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message || `Gagal menghapus video (${res.status})`);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("uploads").update({ status: "deleted" }).eq("video_id", data.videoId);
    await supabaseAdmin.from("video_stats").delete().eq("video_id", data.videoId);
    return { ok: true };
  });
