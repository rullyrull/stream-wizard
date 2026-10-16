import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Link2,
  UploadCloud,
  CheckCircle2,
  XCircle,
  FolderOpen,
  Film,
  Loader2,
  CalendarClock,
  Clock,
  Trash2,
  ArrowLeft,
  Eye,
  ThumbsUp,
  MessageCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
  getYoutubeStatus,
  getAppSettings,
  listUploads,
  listYoutubeChannels,
  saveAppSettings,
  uploadFromDrive,
  scheduleUpload,
  cancelScheduledUpload,
  runDueUploads,
} from "@/lib/youtube.functions";
import { getChannelVideoStats } from "@/lib/stats.functions";
import { AiTrendPanel } from "@/components/AiTrendPanel";
import {
  listDriveFolderVideos,
  autoScheduleFolder,
  scheduleSelectedVideos,
} from "@/lib/drive.functions";
import {
  listAutopilots,
  saveAutopilot,
  setAutopilotEnabled,
  runAutopilotScan,
} from "@/lib/autopilot.functions";
import { buildDescription, buildTitle, titleFromFileName } from "@/lib/video-meta";
import { getChannelSettings, saveChannelSettings } from "@/lib/channel-settings.functions";

const countFmt = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const formatCount = (n: number | undefined) => (n === undefined ? "—" : countFmt.format(n));

const DEFAULT_FOLDER_URL =
  "https://drive.google.com/drive/folders/1IzcsZbKEKGRgs4Gc6wcsjKFJeNTUU4Q1?usp=drive_link";

export const Route = createFileRoute("/channel/$channelId")({
  head: () => ({
    meta: [
      { title: "Pilih Video & Jadwal Unggah — Drive to YouTube" },
      {
        name: "description",
        content:
          "Pilih video dari folder Google Drive untuk channel yang dipilih, atur detail unggahan, lalu jadwalkan tayang otomatis.",
      },
      { property: "og:title", content: "Pilih Video & Jadwal Unggah — Drive to YouTube" },
      {
        property: "og:description",
        content:
          "Pilih video dari folder Google Drive dan jadwalkan unggahannya ke channel YouTube pilihan Anda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChannelWorkspace,
});

function ChannelWorkspace() {
  const { channelId } = Route.useParams();
  const queryClient = useQueryClient();

  const statusFn = useServerFn(getYoutubeStatus);
  const uploadsFn = useServerFn(listUploads);
  const settingsFn = useServerFn(getAppSettings);
  const channelsFn = useServerFn(listYoutubeChannels);
  const status = useQuery({ queryKey: ["yt-status"], queryFn: () => statusFn() });
  const uploads = useQuery({ queryKey: ["yt-uploads"], queryFn: () => uploadsFn() });
  const videoStatsFn = useServerFn(getChannelVideoStats);
  const videoStats = useQuery({
    queryKey: ["yt-video-stats", channelId],
    queryFn: () => videoStatsFn({ data: { channelId } }),
    refetchInterval: 30_000, // segar tiap 30 detik
  });
  const statsByVideoId = new Map((videoStats.data ?? []).map((s) => [s.id, s]));
  const settings = useQuery({ queryKey: ["yt-settings"], queryFn: () => settingsFn() });
  const channels = useQuery({ queryKey: ["yt-channels"], queryFn: () => channelsFn() });

  const saveSettingsFn = useServerFn(saveAppSettings);
  const uploadFn = useServerFn(uploadFromDrive);
  const listFolderFn = useServerFn(listDriveFolderVideos);
  const scheduleFn = useServerFn(scheduleUpload);
  const cancelScheduleFn = useServerFn(cancelScheduledUpload);
  const runDueFn = useServerFn(runDueUploads);
  const autoScheduleFn = useServerFn(autoScheduleFolder);
  const scheduleSelectedFn = useServerFn(scheduleSelectedVideos);
  const listAutopilotsFn = useServerFn(listAutopilots);
  const saveAutopilotFn = useServerFn(saveAutopilot);
  const setAutopilotEnabledFn = useServerFn(setAutopilotEnabled);
  const runAutopilotScanFn = useServerFn(runAutopilotScan);
  const autopilots = useQuery({ queryKey: ["autopilots"], queryFn: () => listAutopilotsFn() });
  const autopilot = autopilots.data?.find((a) => a.channel_id === channelId) ?? null;

  const [driveUrl, setDriveUrl] = useState("");
  const [folderUrl, setFolderUrl] = useState(DEFAULT_FOLDER_URL);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("private");
  const [kind, setKind] = useState<"video" | "reels">("video");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [slotTimes, setSlotTimes] = useState("12:00,19:00");
  const [startDate, setStartDate] = useState("");
  const [maxVideos, setMaxVideos] = useState("50");
  const [timezone, setTimezone] = useState("Asia/Makassar");
  const [queue, setQueue] = useState<string[]>([]);
  const [caption, setCaption] = useState("");

  // Caption tetap milik channel ini (dipakai untuk semua videonya).
  const channelSettingsFn = useServerFn(getChannelSettings);
  const saveChannelSettingsFn = useServerFn(saveChannelSettings);
  const channelSettings = useQuery({
    queryKey: ["channel-settings", channelId],
    queryFn: () => channelSettingsFn({ data: { channelId } }),
  });
  const [captionApplied, setCaptionApplied] = useState(false);
  useEffect(() => {
    if (captionApplied || !channelSettings.data) return;
    setCaption(channelSettings.data.description ?? "");
    setCaptionApplied(true);
  }, [channelSettings.data, captionApplied]);

  const [settingsApplied, setSettingsApplied] = useState(false);
  useEffect(() => {
    if (settingsApplied || !settings.data) return;
    setKind(settings.data.kind === "reels" ? "reels" : "video");
    setPrivacy(settings.data.privacy);
    if (settings.data.description) setDescription(settings.data.description);
    if (settings.data.slotTimes) setSlotTimes(settings.data.slotTimes);
    setSettingsApplied(true);
  }, [settings.data, settingsApplied]);

  const connected = status.data?.connected ?? false;
  const channelTitle = channels.data?.find((c) => c.id === channelId)?.title ?? null;

  const saveSettings = useMutation({
    mutationFn: () =>
      saveSettingsFn({
        data: { channelId, channelTitle, kind, privacy, description },
      }),
    onSuccess: () => {
      toast.success("Pengaturan default disimpan.");
      queryClient.invalidateQueries({ queryKey: ["yt-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveCaption = useMutation({
    mutationFn: () =>
      saveChannelSettingsFn({
        data: {
          channelId,
          channelTitle: channelTitle ?? channelSettings.data?.channelTitle ?? null,
          folderUrl: channelSettings.data?.folderUrl ?? folderUrl,
          folderName: channelSettings.data?.folderName ?? null,
          kind: channelSettings.data?.kind ?? kind,
          privacy: channelSettings.data?.privacy ?? privacy,
          slotTimes: channelSettings.data?.slotTimes ?? slotTimes,
          timezone: channelSettings.data?.timezone ?? timezone,
          description: caption,
        },
      }),
    onSuccess: () => {
      toast.success("Caption channel disimpan dan akan dipakai untuk semua video channel ini.");
      setDescription(caption);
      queryClient.invalidateQueries({ queryKey: ["channel-settings", channelId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAuto = useMutation({
    mutationFn: (enabled: boolean) =>
      saveAutopilotFn({
        data: {
          channelId,
          channelTitle,
          folderUrl,
          slotTimes,
          timezone,
          kind,
          privacy,
          maxPerScan: Number(maxVideos) || 20,
          enabled,
        },
      }),
    onSuccess: () => {
      toast.success("Autopilot channel ini disimpan.");
      queryClient.invalidateQueries({ queryKey: ["autopilots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAuto = useMutation({
    mutationFn: (enabled: boolean) => setAutopilotEnabledFn({ data: { channelId, enabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["autopilots"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const scanNow = useMutation({
    mutationFn: () => runAutopilotScanFn(),
    onSuccess: (res) => {
      const total = res.results.reduce((sum, r) => sum + r.scheduled, 0);
      toast.success(`Pemindaian selesai: ${total} video baru masuk antrean.`);
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
      queryClient.invalidateQueries({ queryKey: ["autopilots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const upload = useMutation({
    mutationFn: () =>
      uploadFn({
        data: { driveUrl, title, description, privacy, channelId, channelTitle, kind },
      }),
    onSuccess: (res) => {
      toast.success(
        kind === "reels"
          ? "Short berhasil diunggah. YouTube mungkin memerlukan waktu untuk mengklasifikasikannya."
          : "Video berhasil diunggah ke YouTube!",
      );
      setDriveUrl("");
      setSelectedFileId("");
      setTitle("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
      window.open(res.url, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["yt-uploads"] }),
  });

  const schedule = useMutation({
    mutationFn: () =>
      scheduleFn({
        data: {
          driveUrl,
          title,
          description,
          privacy,
          channelId,
          channelTitle,
          kind,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        `Jadwal dibuat untuk ${new Date(res.scheduledAt as string).toLocaleString("id-ID")}.`,
      );
      setDriveUrl("");
      setSelectedFileId("");
      setTitle("");
      setScheduledAt("");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelSchedule = useMutation({
    mutationFn: (id: string) => cancelScheduleFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Jadwal dibatalkan.");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const autoSchedule = useMutation({
    mutationFn: () =>
      autoScheduleFn({
        data: {
          folderUrl,
          channelId,
          channelTitle,
          kind,
          privacy,
          slotTimes,
          timezone,
          startDate: startDate || null,
          maxVideos: Number(maxVideos) || 50,
        },
      }),
    onSuccess: (res) => {
      if (res.scheduled === 0) {
        toast.info("Semua video di folder ini sudah dijadwalkan sebelumnya.");
      } else {
        toast.success(
          `${res.scheduled} video dijadwalkan${res.skipped ? `, ${res.skipped} dilewati (duplikat)` : ""}.`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scheduleQueue = useMutation({
    mutationFn: () =>
      scheduleSelectedFn({
        data: {
          folderUrl,
          fileIds: queue,
          channelId,
          channelTitle,
          kind,
          privacy,
          slotTimes,
          timezone,
          startDate: startDate || null,
        },
      }),
    onSuccess: (res) => {
      if (res.scheduled === 0) {
        toast.info("Semua video pilihan sudah dijadwalkan sebelumnya.");
      } else {
        toast.success(`${res.scheduled} video dijadwalkan sesuai slot jam.`);
      }
      setQueue([]);
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scheduledItems = (uploads.data ?? []).filter((u) => u.status === "scheduled");
  const hasDue = scheduledItems.some(
    (u) => u.scheduled_at && new Date(u.scheduled_at).getTime() <= Date.now(),
  );
  useEffect(() => {
    if (!hasDue) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await runDueFn({});
        if (!cancelled && res.processed > 0) {
          toast.info(`${res.processed} jadwal upload dijalankan.`);
          queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
        }
      } catch {
        /* diamkan; akan dicoba lagi */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasDue, runDueFn, queryClient]);

  useEffect(() => {
    if (scheduledItems.length === 0) return;
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    }, 30_000);
    return () => clearInterval(timer);
  }, [scheduledItems.length, queryClient]);

  const browseFolder = useMutation({
    mutationFn: (url: string) =>
      listFolderFn({ data: { folderUrl: url, channelId, channelTitle } }),
    onSuccess: (res) => {
      if (res.needsAuth) {
        toast.info("Hubungkan akun Google Drive dulu untuk memuat folder.");
      } else if (res.videos.length === 0) {
        toast.info("Tidak ada file video di folder ini.");
      } else {
        toast.success(`${res.videos.length} video ditemukan.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const folderVideos = browseFolder.data?.videos ?? [];
  const subFolders = browseFolder.data?.folders ?? [];

  const pickVideo = (file: { id: string; name: string; webViewLink: string }) => {
    setSelectedFileId(file.id);
    setDriveUrl(file.webViewLink);
    // Judul = nama file video. Caption channel dipakai bila sudah diisi.
    setTitle(caption.trim() ? titleFromFileName(file.name) : buildTitle(file.name, channelTitle));
    setDescription(caption.trim() || buildDescription(file.name, channelTitle));
  };

  const usedFileIds = new Set(
    (uploads.data ?? [])
      .filter((u) => ["scheduled", "uploading", "done"].includes(u.status))
      .map((u) => u.drive_file_id)
      .filter(Boolean) as string[],
  );
  const nextAvailable = folderVideos.find((f) => !usedFileIds.has(f.id));

  const tzLabel =
    timezone === "Asia/Jakarta" ? "WIB" : timezone === "Asia/Jayapura" ? "WIT" : "WITA";
  const slotList = slotTimes
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s));
  const toggleQueue = (id: string) =>
    setQueue((q) => (q.includes(id) ? q.filter((x) => x !== id) : [...q, id]));
  const slotLabelFor = (index: number) => {
    if (slotList.length === 0) return "-";
    const day = Math.floor(index / slotList.length);
    const slot = slotList[index % slotList.length];
    const dayLabel = day === 0 ? "Hari 1" : `Hari ${day + 1}`;
    return `${dayLabel} • ${slot} ${tzLabel}`;
  };
  const queueFiles = queue
    .map((id) => folderVideos.find((f) => f.id === id))
    .filter(Boolean) as typeof folderVideos;

  return (
    <main className="min-h-screen px-4 py-12">
      <Toaster />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-80"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-2xl space-y-8">
        <header className="space-y-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="size-4" /> Kembali ke pilih channel
            </Link>
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight">
            {channelTitle ?? "Channel terpilih"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Langkah 2 — pilih video dari folder Drive, lalu Langkah 3 & 4 untuk detail dan waktu
            unggah.
          </p>
        </header>

        <AiTrendPanel channelId={channelId} />


        <section
          className="space-y-5 rounded-2xl border border-border bg-card p-6"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="space-y-2">
            <Label htmlFor="folder">Langkah 2 — Pilih video dari folder Google Drive</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderOpen className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="folder"
                  className="pl-9"
                  placeholder="https://drive.google.com/drive/folders/..."
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={!folderUrl.trim() || browseFolder.isPending}
                onClick={() => browseFolder.mutate(folderUrl)}
              >
                {browseFolder.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>Muat video</>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tempel link folder, lalu pilih video pertama yang tersedia di bawah — video yang
              sudah dijadwalkan/diunggah ditandai.
            </p>

            {subFolders.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {subFolders.map((f) => (
                  <Button
                    key={f.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFolderUrl(f.webViewLink);
                      browseFolder.mutate(f.webViewLink);
                    }}
                  >
                    <FolderOpen className="size-3.5" /> {f.name}
                  </Button>
                ))}
              </div>
            )}

            {folderVideos.length > 0 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-xs text-muted-foreground">
                  {folderVideos.filter((f) => !usedFileIds.has(f.id)).length > 0
                    ? `${folderVideos.filter((f) => !usedFileIds.has(f.id)).length} video belum dijadwalkan`
                    : "Semua video sudah dijadwalkan"}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!nextAvailable}
                  onClick={() => nextAvailable && pickVideo(nextAvailable)}
                >
                  Pilih video pertama yang tersedia
                </Button>
              </div>
            )}

            {folderVideos.length > 0 && (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
                {folderVideos.map((f) => (
                  <li key={f.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Tambah ke antrean jadwal"
                      onClick={() => toggleQueue(f.id)}
                      disabled={usedFileIds.has(f.id)}
                      className={`ml-1 flex size-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-medium transition-colors ${
                        queue.includes(f.id)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      } ${usedFileIds.has(f.id) ? "opacity-40" : ""}`}
                    >
                      {queue.includes(f.id) ? queue.indexOf(f.id) + 1 : "+"}
                    </button>
                    <button
                      type="button"
                      onClick={() => pickVideo(f)}
                      className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        selectedFileId === f.id
                          ? "bg-primary/10 text-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      <Film className="size-4 shrink-0 text-muted-foreground" />
                      <span
                        className={`flex-1 truncate ${usedFileIds.has(f.id) ? "text-muted-foreground line-through" : ""}`}
                      >
                        {f.name}
                      </span>
                      {usedFileIds.has(f.id) && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                          sudah dijadwalkan
                        </span>
                      )}
                      {f.size != null && (
                        <span className="text-xs text-muted-foreground">
                          {(f.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      )}
                      {selectedFileId === f.id && (
                        <CheckCircle2 className="size-4 text-primary" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" />
              <h3 className="text-sm font-medium">Jadwal slot harian</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Tandai video dengan tombol “+” pada daftar di atas sesuai urutan tayang, lalu simpan.
              Video ke-1 masuk slot jam pertama, video ke-2 slot kedua, dan seterusnya (lanjut ke
              hari berikutnya bila slot habis).
            </p>
            <div className="space-y-2">
              <Label htmlFor="slot-times">Slot jam harian</Label>
              <Input
                id="slot-times"
                placeholder="12:00,19:00"
                value={slotTimes}
                onChange={(e) => setSlotTimes(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Jam tayang terbaik untuk audiens Indonesia: 12:00–13:00 dan 19:00–22:00. Pagi hari
                (sebelum 10:00) biasanya sepi, jadi hindari jam 07:00. Jangan menumpuk lebih dari 3
                video per hari agar impresi tiap video tidak terpecah.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Zona waktu</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Asia/Jakarta">WIB (Asia/Jakarta)</SelectItem>
                  <SelectItem value="Asia/Makassar">WITA (Asia/Makassar)</SelectItem>
                  <SelectItem value="Asia/Jayapura">WIT (Asia/Jayapura)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="start-date">Tanggal mulai</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-videos">Jumlah maksimal video</Label>
                <Input
                  id="max-videos"
                  type="number"
                  min={1}
                  max={200}
                  value={maxVideos}
                  onChange={(e) => setMaxVideos(e.target.value)}
                />
              </div>
            </div>

            {queueFiles.length > 0 && (
              <div className="space-y-1 rounded-lg border border-border p-2">
                {queueFiles.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <span className="w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5">
                      {slotLabelFor(i)}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => toggleQueue(f.id)}>
                      Hapus
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button
              type="button"
              className="w-full"
              disabled={!connected || queue.length === 0 || scheduleQueue.isPending}
              onClick={() => scheduleQueue.mutate()}
            >
              {scheduleQueue.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              {scheduleQueue.isPending
                ? "Menyimpan…"
                : `Simpan jadwal ${queue.length ? `(${queue.length} video)` : ""}`}
            </Button>

            <Button
              type="button"
              className="w-full"
              variant="secondary"
              disabled={!connected || !folderUrl.trim() || autoSchedule.isPending}
              onClick={() => autoSchedule.mutate()}
            >
              {autoSchedule.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              {autoSchedule.isPending
                ? "Membuat jadwal…"
                : "Atau jadwalkan semua video di folder otomatis"}
            </Button>
          </div>

          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              <h3 className="text-sm font-medium">Autopilot Google Drive</h3>
              <div className="ml-auto flex items-center gap-2">
                <span
                  className={`text-xs ${
                    autopilot?.enabled ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {autopilot ? (autopilot.enabled ? "Aktif" : "Nonaktif") : "Belum diatur"}
                </span>
                <Switch
                  aria-label="Aktifkan otomatis untuk channel ini"
                  checked={Boolean(autopilot?.enabled)}
                  disabled={toggleAuto.isPending || saveAuto.isPending}
                  onCheckedChange={(v: boolean) => {
                    if (!autopilot) {
                      if (!folderUrl.trim()) {
                        toast.error("Isi link folder Google Drive dulu.");
                        return;
                      }
                      saveAuto.mutate(true);
                      return;
                    }
                    toggleAuto.mutate(v);
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sistem memeriksa folder Drive channel ini otomatis setiap 5 menit. Setiap video baru yang
              Anda tambahkan ke folder langsung masuk antrean upload pada slot jam berikutnya, memakai
              setelan folder, slot jam, zona waktu, jenis, dan privasi di atas.

            </p>
            {autopilot && (
              <p className="text-xs text-muted-foreground">
                Pemeriksaan terakhir:{" "}
                {autopilot.last_scan_at
                  ? new Date(autopilot.last_scan_at).toLocaleString("id-ID")
                  : "belum pernah"}
                {autopilot.last_scan_result ? ` — ${autopilot.last_scan_result}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!folderUrl.trim() || saveAuto.isPending}
                onClick={() => saveAuto.mutate(true)}
              >
                {saveAuto.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {autopilot ? "Simpan & aktifkan autopilot" : "Aktifkan autopilot"}
              </Button>
              {autopilot?.enabled && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={toggleAuto.isPending}
                  onClick={() => toggleAuto.mutate(false)}
                >
                  Nonaktifkan
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!connected || scanNow.isPending}
                onClick={() => scanNow.mutate()}
              >
                {scanNow.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {scanNow.isPending ? "Memindai…" : "Periksa Drive sekarang"}
              </Button>
            </div>
          </div>



          <div className="space-y-2 rounded-lg border p-3">
            <Label htmlFor="channel-caption">Caption channel (dipakai untuk semua video)</Label>
            <Textarea
              id="channel-caption"
              rows={5}
              placeholder="Tulis caption tetap untuk channel ini. Judul video otomatis memakai nama file."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={saveCaption.isPending}
                onClick={() => saveCaption.mutate()}
              >
                {saveCaption.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Simpan caption channel
              </Button>
              <p className="text-xs text-muted-foreground">
                Bila diisi, semua video channel ini memakai caption ini apa adanya dan judulnya
                sama dengan nama file video.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="drive">Link Google Drive (akses publik)</Label>
            <div className="relative">
              <Link2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="drive"
                className="pl-9"
                placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Langkah 3 — Jenis unggahan</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={kind === "video" ? "default" : "secondary"}
                onClick={() => setKind("video")}
              >
                Video biasa
              </Button>
              <Button
                type="button"
                variant={kind === "reels" ? "default" : "secondary"}
                onClick={() => setKind("reels")}
              >
                Reels / Shorts
              </Button>
            </div>
            {kind === "reels" && (
              <p className="text-xs text-muted-foreground">
                YouTube hanya mengklasifikasikan file vertikal atau persegi berdurasi maksimal 3
                menit sebagai Short. Sistem akan memeriksa metadata Drive bila tersedia dan
                menambahkan tag #Shorts otomatis.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Judul video</Label>
            <Input
              id="title"
              placeholder="Judul yang akan tampil di YouTube"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Deskripsi (opsional)</Label>
            <Textarea
              id="desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Visibilitas</Label>
            <Select value={privacy} onValueChange={setPrivacy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Langkah 4 — Waktu unggah</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={mode === "now" ? "default" : "secondary"}
                onClick={() => setMode("now")}
              >
                <UploadCloud className="size-4" /> Upload sekarang
              </Button>
              <Button
                type="button"
                variant={mode === "schedule" ? "default" : "secondary"}
                onClick={() => setMode("schedule")}
              >
                <CalendarClock className="size-4" /> Jadwalkan
              </Button>
            </div>
            {mode === "schedule" && (
              <div className="space-y-2 pt-1">
                <Label htmlFor="schedule-at">Tanggal & jam unggah</Label>
                <Input
                  id="schedule-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "+1 jam", ms: 3_600_000 },
                    { label: "+3 jam", ms: 3 * 3_600_000 },
                    { label: "Besok pagi", ms: null },
                  ].map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const d = new Date();
                        if (preset.ms) d.setTime(d.getTime() + preset.ms);
                        else {
                          d.setDate(d.getDate() + 1);
                          d.setHours(8, 0, 0, 0);
                        }
                        const pad = (n: number) => String(n).padStart(2, "0");
                        setScheduledAt(
                          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                        );
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Jadwal memakai zona waktu perangkat Anda. Unggahan dijalankan otomatis saat
                  waktunya tiba (halaman ini juga memicu jadwal yang jatuh tempo saat dibuka).
                </p>
              </div>
            )}
          </div>

          <Button
            variant="secondary"
            className="w-full"
            disabled={saveSettings.isPending}
            onClick={() => saveSettings.mutate()}
          >
            Simpan sebagai pengaturan default
          </Button>

          {mode === "now" ? (
            <Button
              className="w-full"
              size="lg"
              disabled={!connected || upload.isPending}
              onClick={() => upload.mutate()}
            >
              <UploadCloud className="size-4" />
              {upload.isPending
                ? "Mengunggah…"
                : kind === "reels"
                  ? "Upload Short"
                  : "Upload ke YouTube"}
            </Button>
          ) : (
            <Button
              className="w-full"
              size="lg"
              disabled={!connected || !scheduledAt || schedule.isPending}
              onClick={() => schedule.mutate()}
            >
              <CalendarClock className="size-4" />
              {schedule.isPending ? "Menyimpan jadwal…" : "Jadwalkan upload"}
            </Button>
          )}
          {!connected && (
            <p className="text-center text-xs text-muted-foreground">
              Login akun YouTube dulu untuk mengaktifkan tombol upload.
            </p>
          )}
        </section>

        {scheduledItems.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm tracking-widest text-muted-foreground uppercase">
              Jadwal upload
            </h2>
            <ul className="space-y-2">
              {scheduledItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <Clock className="mt-0.5 size-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.scheduled_at
                        ? new Date(item.scheduled_at).toLocaleString("id-ID")
                        : "Menunggu"}
                      {item.channel_title ? ` • ${item.channel_title}` : ""}
                      {item.kind === "reels" ? " • Shorts" : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancelSchedule.isPending}
                    onClick={() => cancelSchedule.mutate(item.id)}
                  >
                    <Trash2 className="size-4" /> Batalkan
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(uploads.data?.filter((u) => u.status !== "scheduled").length ?? 0) > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm tracking-widest text-muted-foreground uppercase">
              Riwayat upload
            </h2>
            <ul className="space-y-2">
              {uploads.data
                ?.filter((u) => u.status !== "scheduled")
                .map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    {item.status === "done" ? (
                      <CheckCircle2 className="mt-0.5 size-4 text-accent" />
                    ) : item.status === "error" ? (
                      <XCircle className="mt-0.5 size-4 text-destructive" />
                    ) : (
                      <UploadCloud className="mt-0.5 size-4 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.status === "done" && item.video_id ? (
                          <a
                            className="underline"
                            href={`https://youtu.be/${item.video_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            youtu.be/{item.video_id}
                          </a>
                        ) : (
                          (item.error ?? item.status)
                        )}
                      </p>
                      {item.status === "done" && item.video_id && (
                        <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1" title="Penayangan">
                            <Eye className="size-3.5" />
                            {formatCount(statsByVideoId.get(item.video_id)?.views)}
                          </span>
                          <span className="inline-flex items-center gap-1" title="Suka">
                            <ThumbsUp className="size-3.5" />
                            {formatCount(statsByVideoId.get(item.video_id)?.likes)}
                          </span>
                          <span className="inline-flex items-center gap-1" title="Komentar">
                            <MessageCircle className="size-3.5" />
                            {formatCount(statsByVideoId.get(item.video_id)?.comments)}
                          </span>
                          {videoStats.isFetching && (
                            <Loader2 className="size-3 animate-spin" aria-label="Memuat statistik" />
                          )}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
