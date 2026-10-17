/**
 * Server-only: penilaian potensi viral (AI) untuk video di folder Drive.
 * Dipakai oleh tombol manual dan oleh cron (otomatis saat ada video baru).
 */
export type ViralVerdict = "berpotensi" | "tidak";
export type ViralItem = {
  fileId: string;
  name: string;
  webViewLink: string;
  verdict: ViralVerdict;
  reason: string;
};

type DriveVideo = { id: string; name: string; webViewLink: string; size?: string | number | null; modifiedTime?: string | null };

export class AiGatewayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Panggil AI untuk menilai daftar video (maks 50). */
export async function rateVideos(files: DriveVideo[], channelTitle: string | null): Promise<ViralItem[]> {
  if (files.length === 0) return [];
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Kunci AI belum tersedia di server.");

  const catalog = files.map((f, i) => ({
    no: i + 1,
    id: f.id,
    judul: f.name,
    ukuran_mb: f.size ? Math.round(Number(f.size) / 1_048_576) : null,
    diubah: f.modifiedTime ?? null,
  }));

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      reasoning_effort: "low",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "viral_verdicts",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "verdict", "reason"],
                  properties: {
                    id: { type: "string" },
                    verdict: { type: "string", enum: ["berpotensi", "tidak"] },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "Kamu ahli strategi konten YouTube Shorts berbahasa Indonesia. Nilai potensi viral tiap video dari judul/nama filenya. " +
            "Tandai \"berpotensi\" bila judul menarik, jelas, memancing rasa penasaran, dan cocok untuk Shorts. " +
            "Tandai \"tidak\" bila judul generik (mis. VID_20240101.mp4, final_final.mp4), rusak, duplikat, atau tidak menjual. " +
            "Berikan alasan singkat maksimal 1 kalimat dalam bahasa Indonesia. Jawab hanya JSON sesuai skema.",
        },
        {
          role: "user",
          content:
            `Channel: ${channelTitle ?? "tidak diketahui"}. Nilai ${catalog.length} video berikut (JSON):\n` +
            JSON.stringify(catalog),
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AiGatewayError(res.status, `Analisis AI gagal [${res.status}]: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: { items?: Array<{ id: string; verdict: ViralVerdict; reason: string }> } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Jawaban AI tidak bisa dibaca. Coba lagi.");
  }
  const byId = new Map(files.map((f) => [f.id, f]));
  return (parsed.items ?? [])
    .filter((v) => byId.has(v.id))
    .map((v) => ({
      fileId: v.id,
      name: byId.get(v.id)!.name,
      webViewLink: byId.get(v.id)!.webViewLink,
      verdict: v.verdict === "berpotensi" ? "berpotensi" : "tidak",
      reason: v.reason,
    }));
}

/** Simpan hasil penilaian supaya video yang sama tidak dinilai ulang. */
export async function saveRatings(channelId: string, items: ViralItem[]) {
  if (items.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("viral_ratings").upsert(
    items.map((i) => ({
      drive_file_id: i.fileId,
      channel_id: channelId,
      name: i.name,
      web_view_link: i.webViewLink,
      verdict: i.verdict,
      reason: i.reason,
    })),
    { onConflict: "drive_file_id" },
  );
  if (error) throw new Error(`Hasil penilaian gagal disimpan: ${error.message}`);
}

/** Hapus permanen video di Drive, tandai di sistem. */
export async function deleteDriveFiles(fileIds: string[], accessToken: string) {
  let deleted = 0;
  const failed: string[] = [];
  const ok: string[] = [];
  for (const fileId of fileIds) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.ok || res.status === 404) {
      deleted += 1;
      ok.push(fileId);
    } else failed.push(fileId);
  }
  if (ok.length > 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    await supabaseAdmin.from("uploads").update({ status: "deleted", updated_at: now }).in("drive_file_id", ok);
    await supabaseAdmin.from("viral_ratings").update({ deleted: true }).in("drive_file_id", ok);
  }
  return { deleted, failed: failed.length };
}

const PER_CHANNEL = 50;
const MAX_CHANNELS = 20;

/**
 * Otomatis: nilai video BARU (belum pernah dinilai) di folder Drive tiap channel,
 * lalu hapus yang "tidak berpotensi" — sama seperti tombol "Nilai potensi".
 * Satu proses pada satu waktu (kunci di app_settings), berhenti bila AI menolak (402/403).
 */
export async function autoRateNewDriveVideos() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Remix dapat memiliki tabel tanpa baris pengaturan utama. Pulihkan tanpa
  // menimpa saklar atau pilihan yang sudah tersimpan.
  const { error: setupError } = await supabaseAdmin.from("app_settings").upsert(
    { id: "default", autopilot_enabled: true, slot_times: "12:00,19:00", timezone: "Asia/Jakarta" },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (setupError) throw new Error(`Pengaturan otomatis gagal disiapkan: ${setupError.message}`);
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("app_settings")
    .select("id, autopilot_enabled, viral_paused_reason, viral_lock_until")
    .eq("id", "default")
    .maybeSingle();
  if (settingsError || !settings) throw new Error("Pengaturan otomatis tidak dapat dibaca.");
  if (!settings.autopilot_enabled) return { skipped: "manual" };
  if (settings.viral_paused_reason) return { paused: settings.viral_paused_reason };
  if (settings.viral_lock_until && new Date(settings.viral_lock_until) > new Date())
    return { skipped: "locked" };

  const lockUntil = new Date(Date.now() + 10 * 60_000).toISOString();
  await supabaseAdmin.from("app_settings").update({ viral_lock_until: lockUntil }).eq("id", settings.id);

  const { listFolderVideosDeep } = await import("./drive.server");
  const { resolveChannelFolderId } = await import("./channel-folders.server");
  const { getDriveAccessToken } = await import("./youtube.server");

  const results: Array<{ channelId: string; rated: number; deleted: number; error?: string }> = [];
  try {
    const { data: channels } = await supabaseAdmin
      .from("channel_settings")
      .select("channel_id, channel_title, folder_url")
      .not("folder_url", "is", null)
      .limit(MAX_CHANNELS);

    for (const ch of channels ?? []) {
      const folderUrl = ch.folder_url?.trim();
      if (!folderUrl) continue;
      try {
        const accessToken = await getDriveAccessToken(ch.channel_id);
        const folderId = await resolveChannelFolderId({
          folderUrl,
          channelId: ch.channel_id,
          channelTitle: ch.channel_title,
          accessToken,
        });
        const videos = (await listFolderVideosDeep(folderId, accessToken)).videos;
        if (videos.length === 0) continue;
        const { data: rated } = await supabaseAdmin
          .from("viral_ratings")
          .select("drive_file_id")
          .in("drive_file_id", videos.map((v) => v.id));
        const done = new Set((rated ?? []).map((r) => r.drive_file_id));
        const fresh = videos.filter((v) => !done.has(v.id)).slice(0, PER_CHANNEL);
        if (fresh.length === 0) continue;

        const items = await rateVideos(fresh, ch.channel_title);
        await saveRatings(ch.channel_id, items);
        const bad = items.filter((i) => i.verdict === "tidak").map((i) => i.fileId);
        const del = bad.length ? await deleteDriveFiles(bad, accessToken) : { deleted: 0 };
        results.push({ channelId: ch.channel_id, rated: items.length, deleted: del.deleted });
      } catch (e) {
        if (e instanceof AiGatewayError && (e.status === 402 || e.status === 403)) {
          await supabaseAdmin
            .from("app_settings")
            .update({ viral_paused_reason: e.message.slice(0, 500) })
            .eq("id", settings.id);
          results.push({ channelId: ch.channel_id, rated: 0, deleted: 0, error: e.message });
          break;
        }
        if (e instanceof AiGatewayError && e.status === 429) break;
        results.push({
          channelId: ch.channel_id,
          rated: 0,
          deleted: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    await supabaseAdmin.from("app_settings").update({ viral_lock_until: null }).eq("id", settings.id);
  }
  return { results };
}
