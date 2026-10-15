import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Hasil analisis otomatis terakhir untuk satu channel (hanya baca). */
export const getChannelInsight = createServerFn({ method: "GET" })
  .inputValidator((i) => z.object({ channelId: z.string().min(1) }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("channel_insights")
      .select("report, guidance, best_hours, avg_views, sample_size, updated_at")
      .eq("channel_id", data.channelId)
      .maybeSingle();
    return row ?? null;
  });
