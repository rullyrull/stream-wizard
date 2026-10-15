/** Server-only: catat laporan harian per channel (angka + evaluasi AI). */
const TZ = "Asia/Makassar";

export function localDate(d = new Date(), timeZone = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function buildDailyReports() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { aiText } = await import("./analytics.server");
  const today = localDate();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const [{ data: subs }, { data: stats }, { data: ups }, { data: existing }] = await Promise.all([
    supabaseAdmin.from("channel_sub_stats").select("channel_id, channel_title, subscribers, views, videos"),
    supabaseAdmin.from("video_stats").select("channel_id, views, title, published_at").order("published_at", { ascending: false }).limit(1000),
    supabaseAdmin.from("uploads").select("channel_id, status, updated_at").gte("updated_at", since),
    supabaseAdmin.from("channel_daily_reports").select("*").order("report_date", { ascending: false }).limit(500),
  ]);

  let n = 0;
  for (const s of subs ?? []) {
    const vids = (stats ?? []).filter((v) => v.channel_id === s.channel_id);
    const avg = vids.length ? Math.round(vids.reduce((a, v) => a + Number(v.views), 0) / vids.length) : 0;
    const mine = (ups ?? []).filter((u) => u.channel_id === s.channel_id);
    const done = mine.filter((u) => u.status === "done").length;
    const failed = mine.filter((u) => u.status === "failed" || u.status === "error").length;
    const rows = (existing ?? []).filter((r) => r.channel_id === s.channel_id);
    const cur = rows.find((r) => r.report_date === today);
    const prev = rows.find((r) => r.report_date < today);

    let evaluation = cur?.evaluation ?? null;
    const stale = !cur || !evaluation || Date.now() - new Date(cur.updated_at).getTime() > 6 * 3_600_000;
    if (stale) {
      const top = vids.slice(0, 10).map((v) => `- "${v.title}" ${v.views} view`).join("\n");
      evaluation =
        (await aiText(
          [
            `Evaluasi harian channel YouTube "${s.channel_title ?? "-"}" tanggal ${today}.`,
            `Subscriber ${s.subscribers} (kemarin ${prev?.subscribers ?? "-"}), total view ${s.views} (kemarin ${prev?.total_views ?? "-"}).`,
            `Upload 24 jam: ${done} sukses, ${failed} gagal. Rata-rata view per video: ${avg}.`,
            `Video terbaru:\n${top || "-"}`,
            "Tulis bahasa Indonesia, singkat: 'Perkembangan:' 2-3 poin dengan angka, 'Evaluasi:' 2 poin, 'Fokus besok:' 2 poin.",
          ].join("\n"),
        ).catch(() => null)) ?? evaluation;
    }

    await supabaseAdmin.from("channel_daily_reports").upsert(
      {
        channel_id: s.channel_id,
        channel_title: s.channel_title,
        report_date: today,
        subscribers: Number(s.subscribers),
        total_views: Number(s.views),
        videos: Number(s.videos),
        uploads_done: done,
        uploads_failed: failed,
        avg_views: avg,
        evaluation,
        updated_at: stale ? new Date().toISOString() : cur!.updated_at,
      },
      { onConflict: "channel_id,report_date" },
    );
    n++;
  }
  return { channels: n, date: today };
}
