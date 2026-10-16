import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listUploads } from "@/lib/youtube.functions";

export const Route = createFileRoute("/riwayat")({
  head: () => ({
    meta: [
      { title: "Riwayat Upload — DriveTube Studio" },
      { name: "description", content: "Pantau semua riwayat upload, jadwal, dan kegagalan di setiap channel YouTube." },
      { property: "og:title", content: "Riwayat Upload — DriveTube Studio" },
      { property: "og:description", content: "Pantau status upload semua channel dalam satu halaman." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RiwayatPage,
});

const STATUS: Record<string, { label: string; cls: string }> = {
  done: { label: "Terupload", cls: "bg-primary/15 text-primary" },
  scheduled: { label: "Terjadwal", cls: "bg-accent text-accent-foreground" },
  pending: { label: "Menunggu", cls: "bg-muted text-muted-foreground" },
  uploading: { label: "Mengupload", cls: "bg-secondary text-secondary-foreground" },
  failed: { label: "Gagal", cls: "bg-destructive/15 text-destructive" },
  error: { label: "Gagal", cls: "bg-destructive/15 text-destructive" },
};
const st = (s: string) => STATUS[s] ?? { label: s, cls: "bg-muted text-muted-foreground" };
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

function RiwayatPage() {
  const fn = useServerFn(listUploads);
  const q = useQuery({ queryKey: ["uploads-history"], queryFn: () => fn(), refetchInterval: 30_000 });
  const rows = q.data ?? [];
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [term, setTerm] = useState("");
  const [limit, setLimit] = useState(50);

  const channels = useMemo(
    () => [...new Map(rows.filter((r) => r.channel_id).map((r) => [r.channel_id!, r.channel_title ?? r.channel_id!])).entries()],
    [rows],
  );
  const group = (s: string) => (s === "error" ? "failed" : s);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => (c[group(r.status)] = (c[group(r.status)] ?? 0) + 1));
    return c;
  }, [rows]);
  const filtered = rows.filter(
    (r) =>
      (status === "all" || group(r.status) === status) &&
      (channel === "all" || r.channel_id === channel) &&
      (!term || r.title.toLowerCase().includes(term.toLowerCase())),
  );

  const tabs = [
    ["all", "Semua", rows.length],
    ["done", "Terupload", counts["done"] ?? 0],
    ["scheduled", "Terjadwal", counts["scheduled"] ?? 0],
    ["pending", "Menunggu", (counts["pending"] ?? 0) + (counts["uploading"] ?? 0)],
    ["failed", "Gagal", counts["failed"] ?? 0],
  ] as const;

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Kembali
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Riwayat upload</h1>
            <p className="text-muted-foreground">Pantau semua upload di setiap channel. Diperbarui otomatis tiap 30 detik.</p>
          </div>
          <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} /> Muat ulang
          </Button>
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tabs.map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setStatus(k === "pending" && status === "pending" ? "all" : k)}
              className={`rounded-xl border p-4 text-left transition ${status === k ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted"}`}
            >
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-2xl font-semibold">{n.toLocaleString("id-ID")}</div>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Cari judul video…" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="all">Semua channel</option>
            {channels.map(([id, title]) => (
              <option key={id} value={id}>{title}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Video</th>
                <th className="p-3">Channel</th>
                <th className="p-3">Status</th>
                <th className="p-3">Jadwal</th>
                <th className="p-3">Tayang</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Memuat…</td></tr>
              )}
              {!q.isLoading && filtered.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Belum ada riwayat.</td></tr>
              )}
              {filtered.slice(0, limit).map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="max-w-sm p-3">
                    <div className="truncate font-medium">{r.title}</div>
                    {r.error && <div className="truncate text-xs text-destructive" title={r.error}>{r.error}</div>}
                    <div className="text-xs text-muted-foreground">{r.kind === "short" ? "Shorts" : "Video"} · dibuat {fmtDate(r.created_at)}</div>
                  </td>
                  <td className="p-3 text-muted-foreground">{r.channel_title ?? "—"}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st(r.status).cls}`}>{st(r.status).label}</span>
                  </td>
                  <td className="whitespace-nowrap p-3 text-muted-foreground">{fmtDate(r.scheduled_at)}</td>
                  <td className="whitespace-nowrap p-3">
                    {r.video_id ? (
                      <a href={`https://youtu.be/${r.video_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        {fmtDate(r.published_at)} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > limit && (
          <div className="text-center">
            <Button variant="outline" onClick={() => setLimit((l) => l + 50)}>
              Tampilkan lagi ({filtered.length - limit} tersisa)
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
