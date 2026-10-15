import { createServerFn } from "@tanstack/react-start";

/**
 * Statistik ringkas per channel + per video, untuk panel "Riwayat upload".
 * Data disegarkan otomatis dari YouTube dengan hemat kuota:
 * - subscriber/total view channel: maksimal 1x per 5 menit
 * - view/like/komentar per video: memakai cache `video_stats`, dan disegarkan
 *   langsung dari YouTube Data API paling cepat 2 menit sekali supaya
 *   angka di panel terasa mendekati realtime, tanpa menghabiskan kuota.
 */
const VIDEO_STATS_MIN_AGE_MIN = 1;

export const getPerformance = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { collectVideoStats } = await import("./analytics.server");

    // Segarkan statistik video (view/like/comment) langsung dari YouTube,
    // dibatasi throttle internal supaya tidak boros kuota.
    await collectVideoStats(VIDEO_STATS_MIN_AGE_MIN).catch((e) =>
      console.error("[performance video stats]", e),
    );

    await refreshChannelSubs().catch((e) => console.error("[performance subs]", e));

    const [{ data: subs }, { data: stats }] = await Promise.all([
      supabaseAdmin
        .from("channel_sub_stats")
        .select("channel_id, channel_title, subscribers, views, videos, prev_subscribers, checked_at"),
      supabaseAdmin
        .from("video_stats")
        .select("video_id, channel_id, views, likes, comments, checked_at")
        .order("checked_at", { ascending: false })
        .limit(1000),
    ]);

    return {
      channels: subs ?? [],
      videos: stats ?? [],
      error: null as string | null,
    };
  } catch (err) {
    console.error("[performance]", err);
    return {
      channels: [],
      videos: [],
      error: err instanceof Error ? err.message : "Gagal memuat statistik",
    };
  }
});

/**
 * Paksa segarkan statistik video langsung dari YouTube (tanpa throttle),
 * dipanggil lewat tombol "Segarkan statistik" di panel Riwayat upload.
 */
export const refreshVideoStats = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { collectVideoStats } = await import("./analytics.server");
    const res = await collectVideoStats(0);
    return { ok: true, ...res, error: null as string | null };
  } catch (err) {
    console.error("[refreshVideoStats]", err);
    return {
      ok: false,
      channels: 0,
      videos: 0,
      skipped: false,
      error: err instanceof Error ? err.message : "Gagal menyegarkan statistik",
    };
  }
});

/** Ambil subscriber + total view tiap channel yang terhubung (1 unit kuota per channel). */
async function refreshChannelSubs(minAgeMinutes = 5) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { loadAccounts, getValidAccessToken } = await import("./youtube.server");

  const accounts = await loadAccounts();
  if (accounts.length === 0) return;

  const { data: existing } = await supabaseAdmin
    .from("channel_sub_stats")
    .select("channel_id, subscribers, prev_subscribers, prev_checked_at, checked_at");
  const prevMap = new Map((existing ?? []).map((r) => [r.channel_id, r]));

  const now = Date.now();
  for (const acc of accounts) {
    const prev = prevMap.get(acc.channel_id);
    if (prev?.checked_at && now - new Date(prev.checked_at).getTime() < minAgeMinutes * 60_000) {
      continue;
    }
    try {
      const token = await getValidAccessToken(acc.channel_id);
      const url = new URL("https://www.googleapis.com/youtube/v3/channels");
      url.searchParams.set("part", "statistics,snippet");
      url.searchParams.set("id", acc.channel_id);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
      const json = (await res.json()) as {
        items?: Array<{
          snippet?: { title?: string };
          statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
        }>;
      };
      const item = json.items?.[0];
      if (!item) continue;
      const subscribers = Number(item.statistics?.subscriberCount ?? 0);

      // Pembanding pertumbuhan disegarkan tiap 24 jam.
      const prevAge = prev?.prev_checked_at
        ? now - new Date(prev.prev_checked_at).getTime()
        : Infinity;
      const rollBaseline = prevAge > 24 * 3_600_000;

      await supabaseAdmin.from("channel_sub_stats").upsert(
        {
          channel_id: acc.channel_id,
          channel_title: item.snippet?.title ?? acc.channel_title,
          subscribers,
          views: Number(item.statistics?.viewCount ?? 0),
          videos: Number(item.statistics?.videoCount ?? 0),
          prev_subscribers: rollBaseline ? (prev?.subscribers ?? subscribers) : (prev?.prev_subscribers ?? subscribers),
          prev_checked_at: rollBaseline ? new Date().toISOString() : (prev?.prev_checked_at ?? new Date().toISOString()),
          checked_at: new Date().toISOString(),
        },
        { onConflict: "channel_id" },
      );
    } catch (err) {
      console.error("[performance subs]", acc.channel_id, err instanceof Error ? err.message : err);
    }
  }
}
