import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDailyReports, generateDailyReportsNow } from "@/lib/daily-report.functions";

export const Route = createFileRoute("/laporan")({
  head: () => ({
    meta: [
      { title: "Laporan Harian Channel — Drive to YouTube" },
      { name: "description", content: "Hasil analisis, evaluasi, dan perkembangan channel YouTube per hari." },
      { property: "og:title", content: "Laporan Harian Channel" },
      { property: "og:description", content: "Analisis, evaluasi, dan perkembangan channel per hari." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LaporanPage,
});

const fmt = (n: number) => Number(n).toLocaleString("id-ID");
const delta = (a: number, b?: number) => {
  if (b === undefined) return null;
  const d = Number(a) - Number(b);
  return <span className={d >= 0 ? "text-primary" : "text-destructive"}>{d >= 0 ? "+" : ""}{fmt(d)}</span>;
};

function LaporanPage() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getDailyReports);
  const genFn = useServerFn(generateDailyReportsNow);
  const q = useQuery({ queryKey: ["daily-reports"], queryFn: () => fetchFn(), refetchInterval: 5 * 60_000 });
  const gen = useMutation({ mutationFn: () => genFn(), onSuccess: () => qc.invalidateQueries({ queryKey: ["daily-reports"] }) });
  const rows = q.data ?? [];
  const dates = useMemo(() => [...new Set(rows.map((r) => r.report_date))], [rows]);
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? dates[0];
  const dayRows = rows.filter((r) => r.report_date === date);
  const prevOf = (cid: string) => rows.find((r) => r.channel_id === cid && r.report_date < (date ?? ""));
  const sum = (k: "subscribers" | "total_views" | "uploads_done" | "uploads_failed") =>
    dayRows.reduce((a, r) => a + Number(r[k]), 0);

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Kembali
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Laporan harian</h1>
            <p className="text-muted-foreground">Analisis, evaluasi, dan perkembangan semua channel per hari.</p>
          </div>
          <Button variant="outline" onClick={() => gen.mutate()} disabled={gen.isPending}>
            <RefreshCw className={`size-4 ${gen.isPending ? "animate-spin" : ""}`} /> Perbarui hari ini
          </Button>
        </header>

        {q.isLoading ? (
          <p className="text-muted-foreground">Memuat…</p>
        ) : dates.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-6 text-muted-foreground">
            Belum ada laporan. Laporan dibuat otomatis tiap jam, atau tekan "Perbarui hari ini".
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {dates.map((d) => (
                <Button key={d} size="sm" variant={d === date ? "default" : "outline"} onClick={() => setPicked(d)}>
                  {new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" })}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Subscriber", fmt(sum("subscribers"))],
                ["Total view", fmt(sum("total_views"))],
                ["Upload sukses", fmt(sum("uploads_done"))],
                ["Upload gagal", fmt(sum("uploads_failed"))],
              ].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-border bg-card p-4">
                  <div className="text-xs text-muted-foreground">{l}</div>
                  <div className="text-xl font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="space-y-4">
              {dayRows.map((r) => {
                const p = prevOf(r.channel_id);
                return (
                  <section key={r.id} className="space-y-3 rounded-2xl border border-border bg-card p-5">
                    <h2 className="font-semibold">{r.channel_title ?? r.channel_id}</h2>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                      <span>Subscriber <b>{fmt(r.subscribers)}</b> {delta(r.subscribers, p?.subscribers)}</span>
                      <span>View <b>{fmt(r.total_views)}</b> {delta(r.total_views, p?.total_views)}</span>
                      <span>Rata-rata view/video <b>{fmt(Number(r.avg_views))}</b></span>
                      <span>Upload <b>{r.uploads_done}</b> sukses, <b>{r.uploads_failed}</b> gagal</span>
                    </div>
                    {r.evaluation && (
                      <div className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm leading-relaxed">{r.evaluation}</div>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
