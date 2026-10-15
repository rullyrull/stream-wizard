import { createServerFn } from "@tanstack/react-start";

/** Pengaturan per channel: 1 channel = 1 folder Drive + 1 set jadwal. */
export type ChannelSettings = {
  channelId: string;
  channelTitle: string | null;
  folderUrl: string;
  folderName: string | null;
  kind: "video" | "reels";
  privacy: "private" | "unlisted" | "public";
  slotTimes: string;
  timezone: string;
  description: string;
};

const DEFAULTS = {
  folderUrl: "",
  folderName: null as string | null,
  kind: "video" as const,
  privacy: "public" as const,
  slotTimes: "06:00,13:00,19:00",
  timezone: "Asia/Jakarta",
  description: "",
};

export const getChannelSettings = createServerFn({ method: "POST" })
  .inputValidator((input: { channelId: string }) => {
    const channelId = input?.channelId?.trim() ?? "";
    if (!channelId) throw new Error("Pilih channel dulu.");
    return { channelId };
  })
  .handler(async ({ data }): Promise<ChannelSettings> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("channel_settings")
      .select("*")
      .eq("channel_id", data.channelId)
      .maybeSingle();
    return {
      channelId: data.channelId,
      channelTitle: row?.channel_title ?? null,
      folderUrl: row?.folder_url ?? DEFAULTS.folderUrl,
      folderName: row?.folder_name ?? DEFAULTS.folderName,
      kind: row?.kind === "reels" ? "reels" : "video",
      privacy: (["private", "unlisted", "public"].includes(row?.privacy ?? "")
        ? row!.privacy
        : DEFAULTS.privacy) as ChannelSettings["privacy"],
      slotTimes: row?.slot_times ?? DEFAULTS.slotTimes,
      timezone: row?.timezone ?? DEFAULTS.timezone,
      description: row?.description ?? DEFAULTS.description,
    };
  });

export const saveChannelSettings = createServerFn({ method: "POST" })
  .inputValidator((input: {
    channelId: string;
    channelTitle?: string | null;
    folderUrl?: string | null;
    folderName?: string | null;
    kind?: string;
    privacy?: string;
    slotTimes?: string;
    timezone?: string;
    description?: string;
  }) => {
    const channelId = input?.channelId?.trim() ?? "";
    if (!channelId) throw new Error("Pilih channel dulu.");
    return {
      channelId,
      channelTitle: input.channelTitle?.trim() || null,
      folderUrl: input.folderUrl?.trim() || null,
      folderName: input.folderName?.trim() || null,
      kind: input.kind === "reels" ? "reels" : "video",
      privacy: ["private", "unlisted", "public"].includes(input.privacy ?? "")
        ? input.privacy!
        : "public",
      slotTimes: input.slotTimes?.trim() || DEFAULTS.slotTimes,
      timezone: input.timezone?.trim() || DEFAULTS.timezone,
      description: (input.description ?? "").slice(0, 4500),
    };
  })
  .handler(async ({ data }) => {
    const { parseSlotTimes } = await import("./schedule.server");
    parseSlotTimes(data.slotTimes);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("channel_settings").upsert(
      {
        channel_id: data.channelId,
        channel_title: data.channelTitle,
        folder_url: data.folderUrl,
        folder_name: data.folderName,
        kind: data.kind,
        privacy: data.privacy,
        slot_times: data.slotTimes,
        timezone: data.timezone,
        description: data.description,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );
    if (error) throw new Error(error.message);
    if (data.folderUrl) {
      const { syncChannelToSchedule } = await import("./autopilot.server");
      await syncChannelToSchedule(data.channelId, data.channelTitle).catch((e) =>
        console.error("[sync schedule]", e),
      );
    }
    return { ok: true };
  });

/**
 * Daftar folder untuk dropdown: subfolder dari link folder induk (bila ada),
 * folder induk itu sendiri, lalu semua folder lain yang bisa dibaca akun
 * Google Drive yang terhubung.
 */
export const listDriveSubfolders = createServerFn({ method: "POST" })
  .inputValidator((input: { parentUrl?: string | null }) => ({
    parentUrl: input?.parentUrl?.trim() ?? "",
  }))
  .handler(async ({ data }) => {
    const { parseDriveFolderId, listFolderVideos, getDriveFolderName, searchDriveFolders } =
      await import("./drive.server");
    const { getDriveAccessToken } = await import("./youtube.server");
    let accessToken: string;
    try {
      accessToken = await getDriveAccessToken(null);
    } catch {
      return {
        needsAuth: true as boolean,
        parentName: null as string | null,
        folders: [] as Array<{ id: string; name: string; webViewLink: string }>,
      };
    }

    const parentId = data.parentUrl ? parseDriveFolderId(data.parentUrl) : null;
    let parentName: string | null = null;
    const folders: Array<{ id: string; name: string; webViewLink: string }> = [];
    const seen = new Set<string>();
    const push = (f: { id: string; name: string; webViewLink: string }) => {
      if (seen.has(f.id)) return;
      seen.add(f.id);
      folders.push(f);
    };

    if (parentId) {
      parentName = await getDriveFolderName(parentId, accessToken);
      if (parentName) {
        push({
          id: parentId,
          name: parentName,
          webViewLink: `https://drive.google.com/drive/folders/${parentId}`,
        });
      }
      try {
        const entries = await listFolderVideos(parentId, accessToken);
        for (const e of entries) {
          if (e.mimeType === "application/vnd.google-apps.folder") {
            push({ id: e.id, name: e.name, webViewLink: e.webViewLink });
          }
        }
      } catch {
        // folder induk tidak terbaca — tetap tampilkan folder lain di bawah
      }
    }

    try {
      for (const f of await searchDriveFolders(accessToken)) push(f);
    } catch {
      // biarkan daftar seperti apa adanya
    }

    return { needsAuth: false as boolean, parentName, folders };
  });

/** Folder Drive tersimpan untuk semua channel sekaligus (untuk tampilan Langkah 2). */
export const listChannelFolders = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("channel_settings")
    .select("channel_id, folder_url, folder_name");
  return (data ?? []).map((r) => ({
    channelId: r.channel_id,
    folderUrl: r.folder_url ?? "",
    folderName: r.folder_name ?? null,
  }));
});

/** Simpan hanya folder Drive untuk satu channel (pengaturan lain tidak disentuh). */
export const setChannelFolder = createServerFn({ method: "POST" })
  .inputValidator((input: {
    channelId: string;
    channelTitle?: string | null;
    folderUrl: string;
    folderName?: string | null;
  }) => {
    const channelId = input?.channelId?.trim() ?? "";
    if (!channelId) throw new Error("Channel wajib dipilih.");
    if (!input?.folderUrl?.trim()) throw new Error("Folder wajib dipilih.");
    return {
      channelId,
      channelTitle: input.channelTitle?.trim() || null,
      folderUrl: input.folderUrl.trim(),
      folderName: input.folderName?.trim() || null,
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("channel_settings").upsert(
      {
        channel_id: data.channelId,
        channel_title: data.channelTitle,
        folder_url: data.folderUrl,
        folder_name: data.folderName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );
    if (error) throw new Error(error.message);
    const { syncChannelToSchedule } = await import("./autopilot.server");
    const sync = await syncChannelToSchedule(data.channelId, data.channelTitle).catch((e) => ({
      scheduled: 0,
      error: e instanceof Error ? e.message : String(e),
    }));
    return { ok: true, sync };
  });
