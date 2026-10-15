import { createServerFn } from "@tanstack/react-start";

export const getDailyReports = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("channel_daily_reports")
    .select("*")
    .order("report_date", { ascending: false })
    .limit(600);
  return data ?? [];
});

export const generateDailyReportsNow = createServerFn({ method: "POST" }).handler(async () => {
  const { buildDailyReports } = await import("./daily-report.server");
  return buildDailyReports();
});
