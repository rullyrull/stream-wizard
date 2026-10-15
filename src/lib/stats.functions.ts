import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Statistik view/like/komentar per video untuk satu channel.
 * Selalu mengambil data segar dari YouTube Data API, lalu menyimpannya
 * ke tabel video_stats agar dipakai juga oleh analisis autopilot.
 */
export const getChannelVideoStats = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ channelId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getValidAccessToken } = await import("./youtube.server");
    const { fetchStats } = await import("./analytics.server");

    const { data: uploads } = await supabaseAdmin
      .from("uploads")
      .select("video_id")
      .eq("channel_id", data.channelId)
      .eq("status", "done")
      .not("video_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(60);

    const videoIds = [...new Set((uploads ?? []).map((u) => u.video_id as string))];
    if (videoIds.length === 0) return [];

    let token: string;
    try {
      token = await getValidAccessToken(data.channelId);
    } catch {
      return [];
    }

    const stats = await fetchStats(videoIds, token);

    await supabaseAdmin.from("video_stats").upsert(
      stats.map((s) => ({
        video_id: s.id,
        channel_id: data.channelId,
        title: s.title,
        published_at: s.publishedAt,
        views: s.views,
        likes: s.likes,
        comments: s.comments,
        checked_at: new Date().toISOString(),
      })),
      { onConflict: "video_id" },
    );

    return stats;
  });
