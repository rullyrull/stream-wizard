import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint terjadwal (dipanggil pg_cron):
 * 1. Pindai Google Drive untuk semua channel yang autopilot-nya aktif
 * 2. Proses antrean upload yang sudah jatuh tempo
 *
 * Diamankan dengan autentikasi penjadwal terkelola.
 */
async function handle(request: Request) {
  const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
  const authFailure = await authenticateCronRequest(request);
  if (authFailure) return authFailure;

  try {
    // Saklar global: kalau OFF, sistem tidak memindai Drive maupun mengunggah —
    // hanya analisis ringan yang tetap jalan. Semua upload dikerjakan manual.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: masterRow } = await supabaseAdmin
      .from("app_settings")
      .select("autopilot_enabled")
      .limit(1)
      .maybeSingle();
    const masterOn = masterRow?.autopilot_enabled ?? true;
    // Laporan harian tetap dicatat di mode apa pun.
    await import("@/lib/daily-report.server")
      .then(({ buildDailyReports }) => buildDailyReports())
      .catch((e) => console.error("[daily report]", e));
    if (!masterOn) {
      const analytics = await import("@/lib/analytics.server");
      const stats = await analytics.collectVideoStats().catch((e) => ({ error: String(e) }));
      return new Response(
        JSON.stringify({ ok: true, mode: "manual", stats }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    // Mode otomatis penuh: analisa → terapkan jam terbaik → pindai Drive → unggah yang jatuh tempo.
    const [{ republishStuckPrivateVideos }, analytics, autopilot, runner] =
      await Promise.all([
        import("@/lib/youtube.server"),
        import("@/lib/analytics.server"),
        import("@/lib/autopilot.server"),
        import("@/lib/upload-runner.server"),
      ]);
    // Analisa performa dulu supaya video baru langsung memakai strategi terbaru.
    const stats = await analytics.collectVideoStats().catch((e) => ({ error: String(e) }));
    const insights = await analytics.refreshChannelInsights().catch((e) => ({ error: String(e) }));
    const enabled = await autopilot.enableAutopilotForAllChannels().catch((e) => ({ error: String(e) }));
    // Video baru dinilai setiap pemindaian; hasil tersimpan mencegah penilaian ulang.
    // Jangan bergantung pada satu menit harian yang mudah terlewat.
    const scanDue = new Date().getUTCMinutes() % 15 === 0;
    const viral = scanDue
      ? await import("@/lib/viral.server")
          .then(({ autoRateNewDriveVideos }) => autoRateNewDriveVideos())
          .catch((e) => ({ error: String(e) }))
      : { skipped: true };
    // Pindai Drive cukup tiap 15 menit agar hemat kuota.
    const scan = scanDue
      ? await autopilot.scanAllAutopilots().catch((e) => ({ error: String(e) }))
      : { skipped: true };
    const uploads = await runner.processDueUploads().catch((e) => ({ error: String(e) }));
    const republished = await republishStuckPrivateVideos();
    // Audit 12 jam: video dengan view < 100 dihapus permanen dari YouTube.
    const audit = await import("@/lib/audit.server")
      .then(({ auditPublishedUploads }) => auditPublishedUploads())
      .catch((e) => ({ error: String(e) }));
    return new Response(JSON.stringify({ ok: true, stats, insights, enabled, viral, scan, uploads, republished, audit }), {
      headers: { "Content-Type": "application/json" },
    });


  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/cron/autopilot")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      GET: ({ request }) => handle(request),
    },
  },
});
