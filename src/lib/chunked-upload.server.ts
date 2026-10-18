/**
 * Server-only: upload Drive → YouTube yang bisa dilanjutkan antar panggilan.
 *
 * Panggilan terjadwal otomatis hanya hidup sebentar, jadi satu video tidak
 * boleh diunggah dalam satu tarikan. Status sesi upload (URL resumable YouTube,
 * ukuran, posisi) disimpan di baris `uploads`; setiap panggilan mengirim
 * beberapa potongan sampai batas waktunya habis, lalu panggilan berikutnya
 * melanjutkan dari posisi yang dikonfirmasi YouTube.
 */
import { CHUNK_SIZE, nextChunkRange, parseUploadedOffset } from "./chunked-upload";
import type { UploadJob } from "./upload-runner.server";

/** Baris yang sedang dikerjakan tanpa sesi lama dianggap macet setelah ini. */
const LEGACY_STUCK_MS = 10 * 60_000;
/** Panggilan lain tidak menyentuh baris yang baru diperbarui (anti dobel). */
const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 3;
const DAILY_LIMIT = 3;

type Row = {
  id: string;
  title: string;
  description: string | null;
  drive_url: string;
  drive_file_id: string | null;
  privacy: string;
  channel_id: string | null;
  kind: string;
  updated_at: string;
  upload_session_url: string | null;
  upload_total_bytes: number | null;
  upload_offset: number;
  upload_tags: string[] | null;
  upload_attempts: number;
};

const COLS =
  "id, title, description, drive_url, drive_file_id, privacy, channel_id, kind, updated_at, upload_session_url, upload_total_bytes, upload_offset, upload_tags, upload_attempts";

async function db() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

function privacyOf(p: string): UploadJob["privacy"] {
  return p === "private" || p === "unlisted" ? p : "public";
}

/** Klaim baris dengan update bersyarat; null bila sudah diambil panggilan lain. */
async function claim(row: Row): Promise<Row | null> {
  const supabaseAdmin = await db();
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("uploads")
    .update({ updated_at: now })
    .eq("id", row.id)
    .eq("updated_at", row.updated_at)
    .select(COLS);
  return (data?.[0] as Row | undefined) ?? null;
}

async function fail(row: Row, message: string) {
  const supabaseAdmin = await db();
  await supabaseAdmin
    .from("uploads")
    .update({ status: "error", error: message, upload_session_url: null, updated_at: new Date().toISOString() })
    .eq("id", row.id);
}

/** Mulai sesi resumable YouTube untuk baris yang baru diklaim. */
async function startSession(row: Row) {
  const supabaseAdmin = await db();
  const yt = await import("./youtube.server");
  const { getDriveFileDownloadInfo } = await import("./drive.server");
  const { assertReelsCompatible, buildFinalMeta } = await import("./upload-runner.server");

  const fileId = row.drive_file_id || yt.parseDriveFileId(row.drive_url);
  if (!fileId) throw new Error("Link Google Drive tidak valid.");
  const kind = row.kind === "reels" ? ("reels" as const) : ("video" as const);
  if (kind === "reels") await assertReelsCompatible(fileId, row.channel_id);

  const driveToken = await yt.getDriveAccessToken(row.channel_id);
  const info = await getDriveFileDownloadInfo(fileId, driveToken);
  const meta = await buildFinalMeta({
    driveUrl: row.drive_url,
    title: row.title,
    description: row.description ?? "",
    privacy: privacyOf(row.privacy),
    channelId: row.channel_id,
    kind,
  });
  const accessToken = await yt.getValidAccessToken(row.channel_id);
  const categoryId = await yt.getChannelCategory(accessToken);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": info.mimeType,
        "X-Upload-Content-Length": String(info.size),
      },
      body: JSON.stringify({
        snippet: {
          title: meta.finalTitle,
          description: meta.finalDescription,
          tags: meta.finalTags.slice(0, 12),
          categoryId,
          defaultAudioLanguage: "id",
        },
        status: {
          privacyStatus: privacyOf(row.privacy),
          selfDeclaredMadeForKids: false,
          embeddable: true,
          publicStatsViewable: true,
        },
      }),
    },
  );
  if (!initRes.ok) {
    throw new Error(`Inisialisasi upload YouTube gagal [${initRes.status}]: ${(await initRes.text()).slice(0, 300)}`);
  }
  const sessionUrl = initRes.headers.get("location");
  if (!sessionUrl) throw new Error("YouTube tidak mengembalikan URL upload.");

  const { data } = await supabaseAdmin
    .from("uploads")
    .update({
      drive_file_id: fileId,
      title: meta.finalTitle,
      description: meta.finalDescription,
      upload_tags: meta.finalTags,
      upload_session_url: sessionUrl,
      upload_total_bytes: info.size,
      upload_offset: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select(COLS);
  return data?.[0] as Row;
}

type ChunkOutcome = { done: true; videoId: string } | { done: false; offset: number } | { expired: true };

async function readOutcome(res: Response): Promise<ChunkOutcome> {
  if (res.status === 200 || res.status === 201) {
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error("YouTube tidak mengembalikan ID video.");
    return { done: true, videoId: body.id };
  }
  if (res.status === 308) {
    await res.body?.cancel();
    return { done: false, offset: parseUploadedOffset(res.headers.get("range")) };
  }
  if (res.status === 404 || res.status === 410) return { expired: true };
  throw new Error(`Upload ke YouTube gagal [${res.status}]: ${(await res.text()).slice(0, 300)}`);
}

/** Tanya YouTube sudah berapa byte yang diterima (aman setelah panggilan terputus). */
async function queryOffset(row: Row, accessToken: string) {
  const res = await fetch(row.upload_session_url!, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": "0",
      "Content-Range": `bytes */${row.upload_total_bytes}`,
    },
  });
  return readOutcome(res);
}

/** Kirim potongan sampai selesai atau batas waktu habis. */
async function advance(row: Row, deadline: number) {
  const supabaseAdmin = await db();
  const yt = await import("./youtube.server");
  const { fetchDriveFileRangeWithToken } = await import("./drive.server");
  const { finalizeUpload } = await import("./upload-runner.server");
  const total = row.upload_total_bytes!;
  const fileId = row.drive_file_id!;
  const accessToken = await yt.getValidAccessToken(row.channel_id);
  const driveToken = await yt.getDriveAccessToken(row.channel_id);

  let outcome = await queryOffset(row, accessToken);
  while (true) {
    if ("expired" in outcome) {
      // Sesi kedaluwarsa: mulai ulang dari awal pada panggilan berikutnya.
      await supabaseAdmin
        .from("uploads")
        .update({ upload_session_url: null, upload_offset: 0, status: "scheduled", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      return { id: row.id, state: "restart" as const };
    }
    if (outcome.done) {
      await finalizeUpload({
        rowId: row.id,
        fileId,
        videoId: outcome.videoId,
        privacy: privacyOf(row.privacy),
        channelId: row.channel_id,
        title: row.title,
        description: row.description ?? "",
      });
      return { id: row.id, state: "done" as const, videoId: outcome.videoId };
    }
    const offset = outcome.offset;
    await supabaseAdmin
      .from("uploads")
      .update({ upload_offset: offset, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (Date.now() > deadline) return { id: row.id, state: "partial" as const, offset, total };

    const { start, end } = nextChunkRange(offset, total, CHUNK_SIZE);
    const part = await fetchDriveFileRangeWithToken(fileId, driveToken, start, end);
    if (!part.ok && part.status !== 206) {
      throw new Error(`Gagal mengunduh potongan file dari Google Drive [${part.status}]`);
    }
    const bytes = await part.arrayBuffer();
    const res = await fetch(row.upload_session_url!, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Range": `bytes ${start}-${start + bytes.byteLength - 1}/${total}`,
      },
      body: bytes,
    });
    outcome = await readOutcome(res);
  }
}

/** Satu langkah pemrosesan antrean: lanjutkan upload berjalan, lalu mulai yang jatuh tempo. */
export async function processUploadStep(budgetMs = 20_000) {
  const supabaseAdmin = await db();
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const results: Array<{ id: string; state: string; error?: string; videoId?: string; offset?: number; total?: number }> = [];

  // 1) Pulihkan baris macet dari cara upload lama (tanpa sesi) → masuk antrean lagi.
  const stuckBefore = new Date(Date.now() - LEGACY_STUCK_MS).toISOString();
  const { data: stuck } = await supabaseAdmin
    .from("uploads")
    .select("id, upload_attempts")
    .eq("status", "uploading")
    .is("upload_session_url", null)
    .lt("updated_at", stuckBefore)
    .limit(50);
  for (const s of stuck ?? []) {
    const attempts = (s.upload_attempts ?? 0) + 1;
    await supabaseAdmin
      .from("uploads")
      .update(
        attempts >= MAX_ATTEMPTS
          ? { status: "error", error: "Upload terhenti berulang kali.", upload_attempts: attempts, updated_at: new Date().toISOString() }
          : { status: "scheduled", upload_attempts: attempts, updated_at: new Date().toISOString() },
      )
      .eq("id", s.id);
  }

  // 2) Lanjutkan upload yang sudah punya sesi.
  const leaseBefore = new Date(Date.now() - LEASE_MS).toISOString();
  const { data: active } = await supabaseAdmin
    .from("uploads")
    .select(COLS)
    .eq("status", "uploading")
    .not("upload_session_url", "is", null)
    .lt("updated_at", leaseBefore)
    .order("updated_at", { ascending: true })
    .limit(5);
  for (const r of (active ?? []) as Row[]) {
    if (Date.now() > deadline) break;
    const row = await claim(r);
    if (!row) continue;
    try {
      results.push(await advance(row, deadline));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Gangguan jaringan sementara: biarkan dilanjutkan panggilan berikutnya.
      results.push({ id: row.id, state: "retry", error: message });
    }
  }

  // 3) Mulai upload baru yang sudah jatuh tempo (patuhi batas harian per channel).
  if (Date.now() < deadline) {
    const { data: paused } = await supabaseAdmin.from("channel_autopilot").select("channel_id").eq("enabled", false);
    const pausedIds = new Set((paused ?? []).map((r) => r.channel_id));
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [{ data: due }, { data: recent }] = await Promise.all([
      supabaseAdmin
        .from("uploads")
        .select(COLS)
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(30),
      supabaseAdmin
        .from("uploads")
        .select("channel_id, status, published_at, updated_at")
        .or(`published_at.gte.${since},status.eq.uploading`),
    ]);
    const used = new Map<string, number>();
    for (const r of recent ?? []) {
      const key = r.channel_id ?? "_";
      used.set(key, (used.get(key) ?? 0) + 1);
    }
    const candidates = ((due ?? []) as Row[]).filter((r) => {
      if (r.channel_id && pausedIds.has(r.channel_id)) return false;
      const key = r.channel_id ?? "_";
      const n = used.get(key) ?? 0;
      if (n >= DAILY_LIMIT) return false;
      used.set(key, n + 1);
      return true;
    });

    for (const c of candidates.slice(0, 2)) {
      if (Date.now() > deadline) break;
      const { data: claimed } = await supabaseAdmin
        .from("uploads")
        .update({ status: "uploading", error: null, updated_at: new Date().toISOString() })
        .eq("id", c.id)
        .eq("status", "scheduled")
        .select(COLS);
      const row = claimed?.[0] as Row | undefined;
      if (!row) continue;
      try {
        const started = row.upload_session_url ? row : await startSession(row);
        results.push(await advance(started, deadline));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await fail(row, message);
        results.push({ id: row.id, state: "error", error: message });
      }
    }
  }

  return { processed: results.length, recovered: stuck?.length ?? 0, results };
}
