import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { getChannelInsight } from "@/lib/ai-insights.functions";

export function AiTrendPanel({ channelId }: { channelId: string }) {
  const fn = useServerFn(getChannelInsight);
  const q = useQuery({
    queryKey: ["channel-insight", channelId],
    queryFn: () => fn({ data: { channelId } }),
    refetchInterval: 5 * 60_000,
  });
  const d = q.data;

  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-card p-6"
      style={{ boxShadow: "var(--shadow-panel)" }}
    >
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="size-4 text-primary" /> Hasil analisis AI otomatis
        </h2>
        <p className="text-sm text-muted-foreground">
          Sistem menganalisis performa channel secara rutin dan langsung menerapkan perbaikan
          (gaya judul & deskripsi, jam tayang) ke video berikutnya.
        </p>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : !d ? (
        <p className="text-sm text-muted-foreground">
          Belum ada hasil. Analisis pertama muncul otomatis setelah channel punya minimal 5 video
          tayang.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Rata-rata view: <b>{d.avg_views}</b></span>
            <span>Dari <b>{d.sample_size}</b> video</span>
            {d.best_hours && <span>Jam tayang terbaik: <b>{d.best_hours}</b></span>}
          </div>
          {d.report && (
            <div className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm leading-relaxed">
              {d.report}
            </div>
          )}
          {d.guidance && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Panduan judul yang sedang dipakai sistem
              </summary>
              <div className="mt-2 whitespace-pre-wrap">{d.guidance}</div>
            </details>
          )}
          <p className="text-xs text-muted-foreground">
            Diperbarui {new Date(d.updated_at).toLocaleString("id-ID")}
          </p>
        </>
      )}
    </section>
  );
}
