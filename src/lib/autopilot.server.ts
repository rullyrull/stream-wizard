/**
 * Server-only: pemindaian otomatis folder Google Drive per channel.
 * Setiap kali dijalankan, video baru yang belum pernah dijadwalkan
 * akan dimasukkan ke antrean upload pada slot jam berikutnya.
 */

export type AutopilotRow = {
  id: string;
  channel_id: string;
  channel_title: string | null;
  folder_url: string;
  slot_times: string;
  timezone: string;
  kind: string;
  privacy: string;
  max_per_scan: number;
  enabled: boolean;
  last_scan_at: string | null;
  last_scan_result: string | null;
};

/** Pindai satu konfigurasi autopilot dan jadwalkan video baru. */
export async function scanAutopilot(row: AutopilotRow) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { listFolderVideosDeep } = await import("./drive.server");
  const { resolveChannelFolderId } = await import("./channel-folders.server");
  const { getDriveAccessToken } = await import("./youtube.server");
  const { buildSlotSchedule } = await import("./schedule.server");
  const { decorateForKind } = await import("./upload-runner.server");
  const { buildTitle, buildDescription } = await import("./video-meta");

  let folderUrl = row.folder_url?.trim() ?? "";
  if (!folderUrl) {
    const { data: cs } = await supabaseAdmin
      .from("channel_settings")
      .select("folder_url")
      .eq("channel_id", row.channel_id)
      .maybeSingle();
    folderUrl = cs?.folder_url?.trim() ?? "";
    if (folderUrl) {
      await supabaseAdmin
        .from("channel_autopilot")
        .update({ folder_url: folderUrl })
        .eq("channel_id", row.channel_id);
    }
  }

  const accessToken = await getDriveAccessToken(row.channel_id);
  const folderId = await resolveChannelFolderId({
    folderUrl,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    accessToken,
  });
  const files = (await listFolderVideosDeep(folderId, accessToken)).videos;
  files.sort((a, b) => a.name.localeCompare(b.name, "id", { numeric: true }));

  if (files.length === 0)
    return { scheduled: 0, skipped: 0, driveDeleted: 0, items: [] as Array<{ title: string; scheduledAt: string }> };


  // Lewati video yang sudah pernah masuk antrean / diunggah.
  const { data: existing } = await supabaseAdmin
    .from("uploads")
    .select("drive_file_id, status")
    .eq("channel_id", row.channel_id)
    .in("status", ["scheduled", "uploading", "done"])
    .in("drive_file_id", files.map((f) => f.id));
  const taken = new Set((existing ?? []).map((r) => r.drive_file_id));
  // Video baru harus lolos penilaian potensi viral harian dulu sebelum dijadwalkan.
  const { data: ratings } = await supabaseAdmin
    .from("viral_ratings")
    .select("drive_file_id, verdict")
    .in("drive_file_id", files.map((f) => f.id));
  const passed = new Set(
    (ratings ?? []).filter((r) => r.verdict === "berpotensi").map((r) => r.drive_file_id),
  );
  for (const f of files) if (!passed.has(f.id)) taken.add(f.id);

  // File yang sudah pernah selesai diunggah tidak perlu disimpan lagi di Drive:
  // hapus permanen supaya folder bersih dan tidak terpindai berulang.
  const uploadedIds = new Set(
    (existing ?? []).filter((r) => r.status === "done").map((r) => r.drive_file_id),
  );
  let driveDeleted = 0;
  if (uploadedIds.size > 0) {
    const { deleteDriveFile } = await import("./drive.server");
    for (const file of files) {
      if (!uploadedIds.has(file.id)) continue;
      try {
        await deleteDriveFile(file.id, accessToken);
        driveDeleted += 1;
      } catch (err) {
        console.error("[autopilot drive delete]", file.id, err);
      }
    }
  }

  // Jadwal dibuat PER HARI: hanya slot hari ini yang diisi. Besok, pemindaian
  // berikutnya menentukan ulang jam tayang dari hasil evaluasi terbaru,
  // sehingga strategi selalu mengikuti perkembangan channel.
  const { data: insight } = await supabaseAdmin
    .from("channel_insights")
    .select("best_hours")
    .eq("channel_id", row.channel_id)
    .maybeSingle();
  const { stripQuietMorning } = await import("./schedule.server");
  const slotTimes = stripQuietMorning(insight?.best_hours?.trim() || row.slot_times);

  const { localDate } = await import("./daily-report.server");
  const today = localDate(new Date(), row.timezone);
  const now = new Date(Date.now() + 60_000);
  // Slot yang sudah berisi video di antrean tidak boleh diisi lagi (1 video per slot).
  const { data: queued } = await supabaseAdmin
    .from("uploads")
    .select("scheduled_at")
    .eq("channel_id", row.channel_id)
    .in("status", ["scheduled", "uploading", "done"])
    .gte("scheduled_at", new Date(Date.now() - 36 * 3600_000).toISOString());
  const usedSlots = new Set(
    (queued ?? []).map((q) => (q.scheduled_at ? new Date(q.scheduled_at).getTime() : 0)),
  );
  const slotsToday = buildSlotSchedule({
    count: 24,
    slotTimes,
    timeZone: row.timezone,
    startAfter: now,
  }).filter((d) => localDate(d, row.timezone) === today && !usedSlots.has(d.getTime()));

  const pending = files
    .filter((f) => !taken.has(f.id))
    .slice(0, Math.min(row.max_per_scan, slotsToday.length));
  if (pending.length === 0)
    return { scheduled: 0, skipped: files.length, driveDeleted, items: [] };

  const kind = row.kind === "reels" ? ("reels" as const) : ("video" as const);
  const privacy = (["private", "unlisted", "public"].includes(row.privacy)
    ? row.privacy
    : "public") as "private" | "unlisted" | "public";

  const times = slotsToday.slice(0, pending.length);

  const { generateVideoMetadata } = await import("./ai-metadata.server");
  const { loadChannelGuidance } = await import("./analytics.server");
  const { getChannelCaption } = await import("./channel-caption.server");
  const { titleFromFileName } = await import("./video-meta");
  const guidance = await loadChannelGuidance(row.channel_id).catch(() => null);
  const caption = await getChannelCaption(row.channel_id);

  const rows = await Promise.all(
    pending.map(async (file, index) => {
      // Caption channel diisi manual → judul = nama file, deskripsi = caption apa adanya.
      const ai = caption
        ? null
        : await generateVideoMetadata({
            fileName: file.name,
            channelTitle: row.channel_title,
            kind,
            guidance,
          }).catch(() => null);


      const { title, description } = caption
        ? { title: titleFromFileName(file.name), description: caption }
        : decorateForKind({
            driveUrl: file.webViewLink,
            title: ai?.title || buildTitle(file.name, row.channel_title),
            description: ai?.description || buildDescription(file.name, row.channel_title),
            privacy,
            channelId: row.channel_id,
            kind,
          });
      return {
        drive_url: file.webViewLink,
        drive_file_id: file.id,
        title,
        description,
        privacy,
        status: "scheduled",
        scheduled_at: times[index]!.toISOString(),
        kind,
        channel_id: row.channel_id,
        channel_title: row.channel_title,
      };
    }),
  );


  const { data: inserted, error } = await supabaseAdmin
    .from("uploads")
    .insert(rows)
    .select("title, scheduled_at");
  if (error) throw new Error(error.message);

  return {
    scheduled: inserted?.length ?? 0,
    skipped: files.length - pending.length,
    driveDeleted,
    items: (inserted ?? []).map((r) => ({ title: r.title, scheduledAt: r.scheduled_at! })),
  };

}

/** Pindai semua channel yang autopilot-nya aktif. */
export async function scanAllAutopilots() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Pastikan channel yang sudah pernah dijadwalkan ikut dipantau otomatis.
  await backfillAutopilotsFromUploads().catch((e) => {
    console.error("[autopilot backfill] gagal:", e instanceof Error ? e.message : e);
    return 0;
  });
  const { data } = await supabaseAdmin
    .from("channel_autopilot")
    .select("*")
    .eq("enabled", true);

  const rows = (data ?? []) as AutopilotRow[];
  const results: Array<{
    channelId: string;
    channelTitle: string | null;
    scheduled: number;
    skipped: number;
    error?: string;
  }> = [];

  for (const row of rows) {
    try {
      const res = await scanAutopilot(row);
      results.push({
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        scheduled: res.scheduled,
        skipped: res.skipped,
      });
      await supabaseAdmin
        .from("channel_autopilot")
        .update({
          last_scan_at: new Date().toISOString(),
          last_scan_result: `${res.scheduled} video baru dijadwalkan${res.driveDeleted ? `, ${res.driveDeleted} file lama dihapus dari Drive` : ""}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    } catch (err) {

      const message = err instanceof Error ? err.message : String(err);
      results.push({
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        scheduled: 0,
        skipped: 0,
        error: message,
      });
      await supabaseAdmin
        .from("channel_autopilot")
        .update({
          last_scan_at: new Date().toISOString(),
          last_scan_result: `Gagal: ${message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return { channels: results.length, results };
}

/**
 * Daftarkan/segarkan konfigurasi autopilot untuk sebuah channel.
 * Dipanggil setiap kali user menjadwalkan video dari folder Drive,
 * supaya pemeriksaan berkala langsung aktif tanpa langkah tambahan.
 */
export async function rememberAutopilot(input: {
  channelId?: string | null;
  channelTitle?: string | null;
  folderUrl: string;
  slotTimes: string;
  timezone: string;
  kind: string;
  privacy: string;
}) {
  if (!input.channelId || !input.folderUrl?.trim()) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upsertError } = await supabaseAdmin.from("channel_autopilot").upsert(
      {
        channel_id: input.channelId,
        channel_title: input.channelTitle ?? null,
        folder_url: input.folderUrl.trim(),
        slot_times: input.slotTimes,
        timezone: input.timezone,
        kind: input.kind,
        privacy: input.privacy,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );
    if (upsertError) console.error("[autopilot remember]", input.channelId, upsertError.message);
  } catch (err) {
    console.error("[autopilot remember] gagal:", err instanceof Error ? err.message : err);
  }
}

/**
 * Pulihkan konfigurasi autopilot yang belum ada:
 * untuk setiap channel yang pernah dijadwalkan tapi belum punya baris autopilot,
 * folder Drive-nya ditebak dari folder induk file yang pernah dijadwalkan.
 */
export async function backfillAutopilotsFromUploads() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getDriveFileParentId } = await import("./drive.server");
  const { getDriveAccessToken } = await import("./youtube.server");

  const [{ data: existing }, { data: uploads }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("channel_autopilot").select("channel_id"),
    supabaseAdmin
      .from("uploads")
      .select("channel_id, channel_title, drive_file_id, created_at")
      .not("channel_id", "is", null)
      .not("drive_file_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin.from("app_settings").select("slot_times, timezone, default_kind, default_privacy").limit(1),
  ]);

  const configured = new Set((existing ?? []).map((r) => r.channel_id));
  const seen = new Map<string, { title: string | null; fileId: string }>();
  for (const row of uploads ?? []) {
    const cid = row.channel_id!;
    if (cid === "__drive__" || configured.has(cid) || seen.has(cid)) continue;
    seen.set(cid, { title: row.channel_title ?? null, fileId: row.drive_file_id! });
  }
  console.error("[autopilot backfill] kandidat:", seen.size, "uploads:", (uploads ?? []).length, "existing:", configured.size);
  if (seen.size === 0) return 0;

  const s = settings?.[0];
  let created = 0;
  for (const [channelId, info] of seen) {
    try {
      const accessToken = await getDriveAccessToken(channelId);
      const parentId = await getDriveFileParentId(info.fileId, accessToken);
      if (!parentId) continue;
      await rememberAutopilot({
        channelId,
        channelTitle: info.title,
        folderUrl: `https://drive.google.com/drive/folders/${parentId}`,
        slotTimes: s?.slot_times ?? "06:00,13:00,19:00",
        timezone: s?.timezone ?? "Asia/Makassar",
        kind: s?.default_kind ?? "reels",
        privacy: s?.default_privacy ?? "public",
      });
      created += 1;
    } catch (err) {
      console.error("[autopilot backfill]", channelId, err instanceof Error ? err.message : err);
    }
  }
  return created;
}

/**
 * Nyalakan autopilot untuk setiap channel yang punya folder Drive
 * (dari pengaturan channel), plus tebak folder dari riwayat upload.
 * Jam tayang awal = jam terbaik hasil analisis, atau jam prima default.
 */
export async function enableAutopilotForAllChannels() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: settings }, { data: existing }, { data: insights }] = await Promise.all([
    supabaseAdmin
      .from("channel_settings")
      .select("channel_id, channel_title, folder_url, kind, privacy, timezone")
      .not("folder_url", "is", null),
    supabaseAdmin.from("channel_autopilot").select("channel_id"),
    supabaseAdmin.from("channel_insights").select("channel_id, best_hours"),
  ]);
  const { stripQuietMorning } = await import("./schedule.server");
  const best = new Map(
    (insights ?? []).map((r) => [r.channel_id, stripQuietMorning(r.best_hours ?? "")]),
  );
  let created = 0;
  for (const s of settings ?? []) {
    if (have.has(s.channel_id) || !s.folder_url?.trim()) continue;
    await rememberAutopilot({
      channelId: s.channel_id,
      channelTitle: s.channel_title,
      folderUrl: s.folder_url,
      slotTimes: best.get(s.channel_id) || "12:30,19:00",
      timezone: s.timezone || "Asia/Makassar",
      kind: s.kind || "short",
      privacy: s.privacy || "public",
    });
    created += 1;
  }
  const backfilled = await backfillAutopilotsFromUploads().catch(() => 0);
  return { created, backfilled };
}

/**
 * Sinkronkan satu channel ke "Jadwal upload semua channel":
 * pastikan baris autopilot ada & aktif (folder dari pengaturan channel),
 * lalu langsung pindai supaya slot hari ini terisi.
 */
export async function syncChannelToSchedule(channelId: string, channelTitle?: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: cs }, { data: existing }, { data: app }] = await Promise.all([
    supabaseAdmin.from("channel_settings").select("*").eq("channel_id", channelId).maybeSingle(),
    supabaseAdmin.from("channel_autopilot").select("*").eq("channel_id", channelId).maybeSingle(),
    supabaseAdmin.from("app_settings").select("slot_times, timezone").limit(1).maybeSingle(),
  ]);
  const folderUrl = cs?.folder_url?.trim() || existing?.folder_url?.trim() || "";
  const title = channelTitle ?? cs?.channel_title ?? existing?.channel_title ?? null;
  const { error } = await supabaseAdmin.from("channel_autopilot").upsert(
    {
      channel_id: channelId,
      channel_title: title,
      folder_url: folderUrl,
      slot_times: existing?.slot_times ?? app?.slot_times ?? "12:00,19:00",
      timezone: existing?.timezone ?? app?.timezone ?? "Asia/Jakarta",
      kind: existing?.kind ?? cs?.kind ?? "short",
      privacy: existing?.privacy ?? cs?.privacy ?? "public",
      enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel_id" },
  );
  if (error) throw new Error(error.message);
  if (!folderUrl) return { scheduled: 0, reason: "no-folder" as const };

  const { data: row } = await supabaseAdmin
    .from("channel_autopilot")
    .select("*")
    .eq("channel_id", channelId)
    .single();
  try {
    const res = await scanAutopilot(row as AutopilotRow);
    await supabaseAdmin
      .from("channel_autopilot")
      .update({
        last_scan_at: new Date().toISOString(),
        last_scan_result: `${res.scheduled} video baru dijadwalkan`,
      })
      .eq("channel_id", channelId);
    return { scheduled: res.scheduled };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("channel_autopilot")
      .update({ last_scan_at: new Date().toISOString(), last_scan_result: `Gagal: ${message}` })
      .eq("channel_id", channelId);
    return { scheduled: 0, error: message };
  }
}
