import { createServerFn } from "@tanstack/react-start";
import type { ViralItem } from "./viral.server";

export type { ViralItem, ViralVerdict } from "./viral.server";

/**
 * Nilai potensi viral tiap video di folder Drive memakai AI (tombol manual).
 */
export const analyzeFolderViralPotential = createServerFn({ method: "POST" })
  .inputValidator((input: {
    folderUrl: string;
    channelId?: string | null;
    channelTitle?: string | null;
    exactFolder?: boolean;
  }) => {
    if (!input?.folderUrl?.trim()) throw new Error("Link folder Google Drive wajib diisi.");
    return {
      folderUrl: input.folderUrl.trim(),
      channelId: input.channelId?.trim() || null,
      channelTitle: input.channelTitle?.trim() || null,
      exactFolder: Boolean(input.exactFolder),
    };
  })
  .handler(async ({ data }) => {
    const { parseDriveFolderId, listFolderVideosDeep } = await import("./drive.server");
    const { resolveChannelFolderId } = await import("./channel-folders.server");
    const { getDriveAccessToken } = await import("./youtube.server");
    const { rateVideos, saveRatings } = await import("./viral.server");

    const accessToken = await getDriveAccessToken(data.channelId);
    const folderId = data.exactFolder
      ? parseDriveFolderId(data.folderUrl)!
      : await resolveChannelFolderId({
          folderUrl: data.folderUrl,
          channelId: data.channelId,
          channelTitle: data.channelTitle,
          accessToken,
        });
    const files = (await listFolderVideosDeep(folderId, accessToken)).videos.slice(0, 50);
    const items = await rateVideos(files, data.channelTitle);
    if (data.channelId) await saveRatings(data.channelId, items);
    // Tombol manual berhasil → lepaskan jeda otomatis bila sebelumnya diblokir.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("app_settings").update({ viral_paused_reason: null }).not("id", "is", null);
    return { items };
  });

/** Hasil penilaian tersimpan (termasuk dari proses otomatis) per channel. */
export const listViralRatings = createServerFn({ method: "POST" })
  .inputValidator((input: { channelIds: string[] }) => ({
    channelIds: (input?.channelIds ?? []).slice(0, 200),
  }))
  .handler(async ({ data }) => {
    if (data.channelIds.length === 0) return { byChannel: {} as Record<string, ViralItem[]> };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("viral_ratings")
      .select("drive_file_id, channel_id, name, web_view_link, verdict, reason")
      .in("channel_id", data.channelIds)
      .eq("deleted", false)
      .order("created_at", { ascending: false })
      .limit(1000);
    const byChannel: Record<string, ViralItem[]> = {};
    for (const r of rows ?? []) {
      (byChannel[r.channel_id] ??= []).push({
        fileId: r.drive_file_id,
        name: r.name,
        webViewLink: r.web_view_link ?? "",
        verdict: r.verdict === "berpotensi" ? "berpotensi" : "tidak",
        reason: r.reason ?? "",
      });
    }
    return { byChannel };
  });

/** Hapus permanen file video di Google Drive (yang dinilai tidak berpotensi). */
export const deleteDriveVideos = createServerFn({ method: "POST" })
  .inputValidator((input: { fileIds: string[]; channelId?: string | null }) => {
    if (!Array.isArray(input?.fileIds) || input.fileIds.length === 0)
      throw new Error("Tidak ada file yang dipilih.");
    return {
      fileIds: input.fileIds.slice(0, 100),
      channelId: input.channelId?.trim() || null,
    };
  })
  .handler(async ({ data }) => {
    const { getDriveAccessToken } = await import("./youtube.server");
    const { deleteDriveFiles } = await import("./viral.server");
    const accessToken = await getDriveAccessToken(data.channelId);
    return deleteDriveFiles(data.fileIds, accessToken);
  });
