import { createServerFn } from "@tanstack/react-start";

export const listAutopilots = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("channel_autopilot")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const saveAutopilot = createServerFn({ method: "POST" })
  .inputValidator((input: {
    channelId: string;
    channelTitle?: string | null;
    folderUrl: string;
    slotTimes: string;
    timezone?: string;
    kind?: string;
    privacy?: string;
    maxPerScan?: number;
    enabled?: boolean;
  }) => {
    if (!input?.channelId?.trim()) throw new Error("Channel wajib dipilih.");
    if (!input?.folderUrl?.trim()) throw new Error("Link folder Google Drive wajib diisi.");
    if (!input?.slotTimes?.trim()) throw new Error("Isi minimal satu slot jam, contoh 06:00.");
    return {
      channelId: input.channelId.trim(),
      channelTitle: input.channelTitle?.trim() || null,
      folderUrl: input.folderUrl.trim(),
      slotTimes: input.slotTimes.trim(),
      timezone: input.timezone?.trim() || "Asia/Makassar",
      kind: input.kind === "reels" ? "reels" : "video",
      privacy: ["private", "unlisted", "public"].includes(input.privacy ?? "")
        ? input.privacy!
        : "public",
      maxPerScan: Math.min(Math.max(Number(input.maxPerScan ?? 20) || 20, 1), 100),
      enabled: input.enabled ?? true,
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { parseSlotTimes } = await import("./schedule.server");
    parseSlotTimes(data.slotTimes);

    const { error } = await supabaseAdmin.from("channel_autopilot").upsert(
      {
        channel_id: data.channelId,
        channel_title: data.channelTitle,
        folder_url: data.folderUrl,
        slot_times: data.slotTimes,
        timezone: data.timezone,
        kind: data.kind,
        privacy: data.privacy,
        max_per_scan: data.maxPerScan,
        enabled: data.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setAutopilotEnabled = createServerFn({ method: "POST" })
  .inputValidator((input: { channelId: string; enabled: boolean; channelTitle?: string | null }) => {
    if (!input?.channelId?.trim()) throw new Error("Channel wajib dipilih.");
    return {
      channelId: input.channelId.trim(),
      enabled: Boolean(input.enabled),
      channelTitle: input.channelTitle?.trim() || null,
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Update dulu; kalau channel belum punya baris autopilot, buat baris "jeda"
    // minimal supaya sakelar ON/OFF tetap berfungsi untuk semua channel.
    const { data: updated, error } = await supabaseAdmin
      .from("channel_autopilot")
      .update({ enabled: data.enabled, updated_at: new Date().toISOString() })
      .eq("channel_id", data.channelId)
      .select("channel_id");
    if (error) throw new Error(error.message);
    if (!updated || updated.length === 0) {
      const { error: insErr } = await supabaseAdmin.from("channel_autopilot").insert({
        channel_id: data.channelId,
        channel_title: data.channelTitle,
        folder_url: "",
        enabled: data.enabled,
      });
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });

export const deleteAutopilot = createServerFn({ method: "POST" })
  .inputValidator((input: { channelId: string }) => {
    if (!input?.channelId?.trim()) throw new Error("Channel wajib dipilih.");
    return { channelId: input.channelId.trim() };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("channel_autopilot")
      .delete()
      .eq("channel_id", data.channelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Jalankan pemindaian Drive sekarang untuk semua channel aktif. */
export const runAutopilotScan = createServerFn({ method: "POST" }).handler(async () => {
  const { scanAllAutopilots } = await import("./autopilot.server");
  return await scanAllAutopilots();
});

/** Saklar global: ON = sistem bekerja otomatis, OFF = semua dikerjakan manual. */
export const getAutopilotMasterSwitch = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("autopilot_enabled")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .maybeSingle();
  return { enabled: data?.autopilot_enabled ?? true };
});

export const setAutopilotMasterSwitch = createServerFn({ method: "POST" })
  .inputValidator((input: { enabled: boolean }) => ({ enabled: Boolean(input?.enabled) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert(
      {
        id: "00000000-0000-0000-0000-000000000001",
        autopilot_enabled: data.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Atur jam tayang otomatis untuk SEMUA channel sekaligus:
 * analisis ulang performa tiap channel, lalu pasang jam terbaik hasil analisis.
 * Channel yang datanya belum cukup tetap memakai jam cadangan.
 */
export const applyAutoScheduleAll = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const analytics = await import("./analytics.server");
  const autopilot = await import("./autopilot.server");
  await autopilot.enableAutopilotForAllChannels().catch(() => null);
  await analytics.collectVideoStats().catch(() => null);
  await analytics.refreshChannelInsights(0).catch(() => null);
  const [{ data: aps }, { data: ins }] = await Promise.all([
    supabaseAdmin.from("channel_autopilot").select("channel_id, channel_title, slot_times"),
    supabaseAdmin.from("channel_insights").select("channel_id, best_hours"),
  ]);
  const best = new Map((ins ?? []).map((r) => [r.channel_id, r.best_hours?.trim() || null]));
  const result: Array<{ channelTitle: string | null; slotTimes: string; fromAnalysis: boolean }> = [];
  for (const ap of aps ?? []) {
    const b = best.get(ap.channel_id);
    if (b && b !== ap.slot_times) {
      await supabaseAdmin
        .from("channel_autopilot")
        .update({ slot_times: b, updated_at: new Date().toISOString() })
        .eq("channel_id", ap.channel_id);
    }
    result.push({ channelTitle: ap.channel_title, slotTimes: b || ap.slot_times, fromAnalysis: !!b });
  }
  return { channels: result };
});
