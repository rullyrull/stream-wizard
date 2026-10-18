/**
 * Server-only: eksekusi satu pekerjaan upload Drive → YouTube.
 * Dipakai oleh upload langsung maupun pemroses jadwal.
 */

export type UploadJob = {
  driveUrl: string;
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  channelId: string | null;
  kind: "video" | "reels";
};

/** Validasi khusus Reels/Shorts (rasio & durasi) sebelum upload. */
export async function assertReelsCompatible(fileId: string, channelId: string | null) {
  const { getDriveAccessToken } = await import("./youtube.server");
  const { getDriveVideoMeta } = await import("./drive.server");
  const accessToken = await getDriveAccessToken(channelId);
  const meta = await getDriveVideoMeta(fileId, accessToken);

  if (!meta) {
    throw new Error(
      "Tidak bisa membaca dimensi & durasi file dari Google Drive, jadi YouTube berisiko menempatkannya sebagai video biasa. Pastikan file benar-benar file video di Drive (bukan shortcut/link) dan akun terhubung punya izin Google Drive, lalu coba lagi.",
    );
  }
  if (meta.width > meta.height) {
    throw new Error(
      `File ini landscape (${meta.width}×${meta.height}), sehingga YouTube akan memasukkannya sebagai video biasa. Gunakan video vertikal (mis. 1080×1920).`,
    );
  }
  if (meta.durationMs === null) {
    throw new Error(
      "Durasi file tidak terbaca dari Google Drive. YouTube Shorts hanya menerima video maksimal 180 detik, jadi unggahan dihentikan agar tidak menjadi video biasa.",
    );
  }
  if (meta.durationMs > 180_000) {
    const durationSeconds = Math.ceil(meta.durationMs / 1000);
    throw new Error(
      `Durasi file ${durationSeconds} detik. YouTube Shorts hanya menerima video maksimal 180 detik (3 menit).`,
    );
  }
}

const STOPWORDS = new Set([
  "yang","dan","di","ke","dari","untuk","dengan","ini","itu","pada","the","a","an","of","in","on","for","to","is","are",
]);

/**
 * Tag relevan dari judul saja.
 * Tag generik ("viral", "fyp", "trending") sengaja TIDAK dipakai:
 * YouTube menilainya sebagai tag-stuffing dan justru menekan distribusi,
 * sehingga video hasil sistem tampil jauh lebih sedikit dibanding upload manual.
 */
export function buildViralTags(title: string, kind: "video" | "reels") {
  const keywords = title
    .toLowerCase()
    .replace(/#[\w]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  // Frasa dari judul (2 kata berurutan) lebih bernilai daripada kata acak.
  const phrases: string[] = [];
  for (let i = 0; i < Math.min(keywords.length - 1, 4); i += 1) {
    phrases.push(`${keywords[i]} ${keywords[i + 1]}`);
  }

  const base = kind === "reels" ? ["shorts"] : [];
  return Array.from(new Set([...keywords.slice(0, 8), ...phrases, ...base]))
    .filter(Boolean)
    .slice(0, 12);
}

/** Deskripsi natural: isi + CTA singkat + maksimal 3 hashtag relevan. */
export function buildViralDescription(title: string, description: string, kind: "video" | "reels") {
  const existing = description?.trim();
  // Deskripsi yang sudah dirakit (mengandung hashtag) dipakai apa adanya.
  if (existing && /#\p{L}/u.test(existing)) return existing.slice(0, 4500);

  const hashtags = buildViralTags(title, kind)
    .filter((t) => !t.includes(" ") && t !== "shorts")
    .slice(0, kind === "reels" ? 2 : 3)
    .map((t) => `#${t.replace(/[^\p{L}\p{N}]/gu, "")}`);
  if (kind === "reels") hashtags.push("#Shorts");

  const body = existing || `${title.replace(/#\w+/g, "").trim()}`;
  const cta =
    kind === "reels"
      ? "Suka videonya? Subscribe untuk video baru setiap hari."
      : "Subscribe untuk video terbaru lainnya.";

  return [body, cta, hashtags.join(" ")].filter(Boolean).join("\n\n").slice(0, 4500);
}


const HEALTH_RE = /sehat|herbal|diet|gula|diabetes|detoks|tubuh|obat|karbo|sayur|makan|penyakit|kesehatan/i;

/**
 * Tepat 5 hashtag: #shorts + 4 hashtag niche populer (dari AI), dilengkapi
 * hashtag niche bawaan. Potongan kata judul ("#bumi", "#ibu") tidak dipakai
 * karena tidak dicari orang dan tidak membawa audiens.
 */
export function buildFiveHashtags(title: string, aiHashtags: string[]) {
  const clean = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const niche = HEALTH_RE.test(title)
    ? ["tipssehat", "hidupsehat", "kesehatan", "faktakesehatan"]
    : ["dakwah", "kajianislam", "ceramahsingkat", "dakwahislam"];
  const pool = [...aiHashtags.map(clean), ...niche].filter(
    (t) => t.length > 3 && t !== "shorts" && !/viral|fyp|trending/.test(t),
  );
  const picked = Array.from(new Set(pool)).slice(0, 4);
  return ["#shorts", ...picked.map((t) => `#${t}`)].join(" ");
}

/** Akhiran judul khusus per channel (permintaan pemilik channel). */
const SUFFIX_BY_ID: Record<string, string> = {
  "UC4a-WcXrern7Ruwftg8t1bQ": "Barakallah Ustadz Abdul Somad", // UAS Dakwah
  "UCoU-INVVjhJXEFXMd1eunoQ": "Barakallah Ustadz Hanan Attaki", // Ust Hanan Attaki Video
  "UCJchFyHK43MsFCBxikpB11Q": "Barakallah Ustadz Adi Hidayat", // Dakwah Ust Adi Hidayat
  "UC2ETose1YBtmRL3J5GH2m8w": "Barakallah Ustadz Abdul Somad", // Ustadz Abdul Somad Dakwah
  "UC5efhnAWrc9hU3E_mOzHEQg": "Barakallah Ustadz Das'ad Latief", // Ust Das'ad Latief
  "UCvCzniqYlYnq4h1F6k522fg": "Barakallah Habib Ja'far Al - Hadar", // Habib Jafar Video
  "UCwzRiDrrn1gjGXCA3jE5F-A": "Barakallah dr Zaidul Akbar", // Sehat Herbalis
  "UCqpIUDcH1lyQnvbSydOmcKA": "Barakallah Ustadz Adi Hidayat", // Dakwah UAH
};

/** Rapikan judul + deskripsi + tag agar siap tampil dan mudah ditemukan. */
export function decorateForKind(job: UploadJob) {
  // Judul = nama file [+ " - akhiran channel"] + " #shorts", maks 100 karakter.
  const base = job.title.replace(/\s*#shorts\b/gi, "").trim();
  const suffix = job.channelId ? SUFFIX_BY_ID[job.channelId] : undefined;
  const tail = `${suffix && !base.includes(suffix) ? ` - ${suffix}` : ""} #shorts`;
  const title = `${base.slice(0, Math.max(10, 100 - tail.length)).trim()}${tail}`;
  // Sama seperti posting manual: deskripsi apa adanya, tanpa hashtag/CTA/tag tempelan.
  // Hashtag hasil potongan judul (#cara #bikin) & teks generik membuat video terbaca spam.
  const description = (job.description ?? "").trim().slice(0, 4500);
  return { title, description, tags: [] as string[] };
}


/** Judul, deskripsi SEO, dan tag final untuk sebuah upload. */
export async function buildFinalMeta(job: UploadJob) {
  const finalTitle = job.title;
  const { getChannelCaption } = await import("./channel-caption.server");
  const caption = await getChannelCaption(job.channelId);
  const topic = job.title.replace(/#\w+/g, "").trim();
  const { generateVideoMetadata } = await import("./ai-metadata.server");
  const { loadChannelGuidance } = await import("./analytics.server");
  const guidance = await loadChannelGuidance(job.channelId).catch(() => null);
  const ai = await generateVideoMetadata({ fileName: topic, channelTitle: null, kind: "reels", guidance }).catch(
    () => null,
  );
  // Deskripsi SEO: AI (hook + isi + ajakan) diutamakan; caption channel ditambahkan di bawahnya.
  const parts = [ai?.description, caption, !ai?.description && !caption ? topic : null]
    .map((p) => p?.trim())
    .filter(Boolean);
  const body = (parts.length ? parts.join("\n\n") : job.description || topic).trim();
  const sourceLine = ai?.source ? `Sumber video: ${ai.source}` : null;
  const finalDescription = [body, sourceLine, buildFiveHashtags(topic, ai?.hashtags ?? [])]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4500);
  const finalTags: string[] = (ai?.tags ?? []).slice(0, 10);
  return { finalTitle, finalDescription, finalTags };
}

/** Setelah YouTube menerima video: hapus file Drive, cek kunci privasi, tandai selesai. */
export async function finalizeUpload(params: {
  rowId: string;
  fileId: string;
  videoId: string;
  privacy: UploadJob["privacy"];
  channelId: string | null;
  title: string;
  description: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let driveDeleted = true;
  let driveDeleteError: string | null = null;
  try {
    const { getDriveAccessToken } = await import("./youtube.server");
    const { deleteDriveFile } = await import("./drive.server");
    const accessToken = await getDriveAccessToken(params.channelId);
    await deleteDriveFile(params.fileId, accessToken);
  } catch (delErr) {
    driveDeleted = false;
    driveDeleteError = delErr instanceof Error ? delErr.message : String(delErr);
  }

  const { checkVideoLocked } = await import("./youtube.server");
  const lockWarning = await checkVideoLocked(params.videoId, params.privacy, params.channelId);
  const notes = [
    lockWarning,
    driveDeleted ? null : `Upload sukses, tapi file Drive gagal dihapus: ${driveDeleteError}`,
  ].filter(Boolean);

  await supabaseAdmin
    .from("uploads")
    .update({
      status: "done",
      title: params.title,
      description: params.description,
      video_id: params.videoId,
      published_at: new Date().toISOString(),
      upload_session_url: null,
      error: notes.length ? notes.join(" | ") : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.rowId);
  return { driveDeleted };
}

/** Jalankan upload untuk satu baris `uploads` yang sudah ada di database. */
export async function runUploadRow(rowId: string, job: UploadJob, alreadyClaimed = false) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { parseDriveFileId, uploadDriveVideoToYouTube } = await import("./youtube.server");

  const fileId = parseDriveFileId(job.driveUrl);
  if (!fileId) throw new Error("Link Google Drive tidak valid.");

  if (!alreadyClaimed) {
    await supabaseAdmin
      .from("uploads")
      .update({ status: "uploading", error: null, updated_at: new Date().toISOString() })
      .eq("id", rowId);
  }

  try {
    if (job.kind === "reels") await assertReelsCompatible(fileId, job.channelId);
    const { finalTitle, finalDescription, finalTags } = await buildFinalMeta(job);

    const videoId = await uploadDriveVideoToYouTube({
      fileId,
      title: finalTitle,
      description: finalDescription,
      privacy: job.privacy,
      channelId: job.channelId,
      kind: job.kind,
      tags: finalTags,
    });

    const { driveDeleted } = await finalizeUpload({
      rowId,
      fileId,
      videoId,
      privacy: job.privacy,
      channelId: job.channelId,
      title: finalTitle,
      description: finalDescription,
    });
    return { videoId, url: `https://youtu.be/${videoId}`, driveDeleted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("uploads")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", rowId);
    throw new Error(message);
  }
}

/** Proses semua jadwal yang sudah jatuh tempo. */
export async function processDueUploads() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Channel yang sedang dijeda tidak boleh mengunggah apa pun.
  const { data: paused } = await supabaseAdmin
    .from("channel_autopilot")
    .select("channel_id")
    .eq("enabled", false);
  const pausedIds = new Set((paused ?? []).map((r) => r.channel_id));

  const { data } = await supabaseAdmin
    .from("uploads")
    .select("id, title, description, drive_url, privacy, channel_id, kind, scheduled_at")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(20);

  // Batas harian: maksimal DAILY_LIMIT video per channel dalam 24 jam terakhir,
  // agar YouTube tidak menganggap unggahan massal sebagai spam. Sisanya menunggu.
  const DAILY_LIMIT = 3;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("uploads")
    .select("channel_id")
    .in("status", ["done", "uploading"])
    .gte("updated_at", since);
  const usedToday = new Map<string, number>();
  for (const r of recent ?? []) {
    const key = r.channel_id ?? "_";
    usedToday.set(key, (usedToday.get(key) ?? 0) + 1);
  }
  const rows = (data ?? [])
    .filter((r) => !r.channel_id || !pausedIds.has(r.channel_id))
    .filter((r) => {
      const key = r.channel_id ?? "_";
      const used = usedToday.get(key) ?? 0;
      if (used >= DAILY_LIMIT) return false;
      usedToday.set(key, used + 1);
      return true;
    })
    .slice(0, 3);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const row of rows) {
    // Klaim baris secara bersyarat: hanya satu proses yang boleh mengubah
    // status "scheduled" → "uploading", sehingga cron yang tumpang tindih
    // tidak mengunggah video yang sama dua kali.
    const { data: claimed } = await supabaseAdmin
      .from("uploads")
      .update({ status: "uploading", error: null, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed || claimed.length === 0) continue;
    try {
      await runUploadRow(row.id, {
        driveUrl: row.drive_url,
        title: row.title,
        description: row.description ?? "",
        privacy: (row.privacy as UploadJob["privacy"]) ?? "private",
        channelId: row.channel_id ?? null,
        kind: row.kind === "reels" ? "reels" : "video",
      }, true);
      results.push({ id: row.id, ok: true });
    } catch (err) {
      results.push({ id: row.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { processed: results.length, results };
}

/**
 * Cegah video yang sama diunggah dua kali.
 * Cocokkan berdasarkan file Drive yang sama, atau judul yang sama di channel yang sama.
 */
export async function findDuplicateUpload(params: {
  driveFileId: string | null;
  title: string;
  channelId?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const active = ["scheduled", "uploading", "done"];

  if (params.driveFileId) {
    const { data } = await supabaseAdmin
      .from("uploads")
      .select("id, title, status, video_id, channel_title, created_at")
      .eq("drive_file_id", params.driveFileId)
      .in("status", active)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
  }

  const cleanTitle = params.title.trim();
  if (cleanTitle && params.channelId) {
    const { data } = await supabaseAdmin
      .from("uploads")
      .select("id, title, status, video_id, channel_title, created_at")
      .eq("channel_id", params.channelId)
      .ilike("title", cleanTitle)
      .in("status", active)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
  }
  return null;
}

export async function assertNotDuplicate(params: {
  driveFileId: string | null;
  title: string;
  channelId?: string | null;
}) {
  const dup = await findDuplicateUpload(params);
  if (!dup) return;
  const where = dup.channel_title ? ` di channel ${dup.channel_title}` : "";
  const state =
    dup.status === "done"
      ? `sudah pernah diposting${where}${dup.video_id ? ` (https://youtu.be/${dup.video_id})` : ""}`
      : dup.status === "scheduled"
        ? `sudah ada di daftar jadwal${where}`
        : `sedang diunggah${where}`;
  throw new Error(`Video ini ${state}. Upload dibatalkan agar tidak dobel.`);
}
