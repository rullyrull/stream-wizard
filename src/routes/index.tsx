import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import {
  Youtube,
  LogOut,
  UploadCloud,
  CheckCircle2,
  XCircle,
  Plus,
  FolderOpen,
  Film,
  Loader2,
  CalendarClock,
  Clock,
  History,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  ThumbsUp,
  MessageCircle,
  Trash2,
  Sparkles,
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
  disconnectYoutube,
  getYoutubeStatus,
  getAppSettings,
  listUploads,
  fetchChannelUploadHistory,
  deleteChannelVideo,
  listSavedChannelHistory,
  type YoutubeHistoryItem,
  listYoutubeChannels,
  saveAppSettings,
  cancelScheduledUpload,
  postScheduledNow,
  cancelAllScheduledUploads,
  runDueUploads,
  disconnectDrive,
  deleteUploadedVideo,
  uploadFromDrive,
} from "@/lib/youtube.functions";
import {
  listDriveFolderVideos,
  autoScheduleFolder,
  scheduleSelectedVideos,
} from "@/lib/drive.functions";
import {
  analyzeFolderViralPotential,
  listViralRatings,
  deleteDriveVideos,
  type ViralItem,
} from "@/lib/viral.functions";
import {
  listAutopilots,
  setAutopilotEnabled,
  getAutopilotMasterSwitch,
  setAutopilotMasterSwitch,
  applyAutoScheduleAll,
} from "@/lib/autopilot.functions";
import { getPerformance, refreshVideoStats } from "@/lib/performance.functions";
import {
  getChannelSettings,
  saveChannelSettings,
  listDriveSubfolders,
  listChannelFolders,
  setChannelFolder,
} from "@/lib/channel-settings.functions";


const DEFAULT_FOLDER_URL =
  "https://drive.google.com/drive/folders/1TxuGXApoNmA7FeCTHce9OsC4n6xvwJ56?usp=drive_link";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Drive to YouTube — Upload Video dari Link Drive" },
      {
        name: "description",
        content:
          "Tempel link Google Drive publik, hubungkan akun YouTube Anda, dan unggah videonya langsung ke channel tanpa mengunduh manual.",
      },
      { property: "og:title", content: "Drive to YouTube — Upload Video dari Link Drive" },
      {
        property: "og:description",
        content:
          "Tempel link Google Drive publik dan unggah videonya langsung ke channel YouTube Anda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const queryClient = useQueryClient();
  const statusFn = useServerFn(getYoutubeStatus);
  const uploadsFn = useServerFn(listUploads);
  const settingsFn = useServerFn(getAppSettings);
  const channelsFn = useServerFn(listYoutubeChannels);
  const resilient = {
    retry: 3,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
    throwOnError: false,
  } as const;
  const status = useQuery({ queryKey: ["yt-status"], queryFn: () => statusFn(), ...resilient });
  const uploads = useQuery({ queryKey: ["yt-uploads"], queryFn: () => uploadsFn(), ...resilient });
  const settings = useQuery({ queryKey: ["yt-settings"], queryFn: () => settingsFn(), ...resilient });
  const saveSettingsFn = useServerFn(saveAppSettings);

  const channels = useQuery({
    queryKey: ["yt-channels"],
    queryFn: () => channelsFn(),
    ...resilient,
  });


  const disconnectFn = useServerFn(disconnectYoutube);
  const cancelScheduleFn = useServerFn(cancelScheduledUpload);
  const postNowFn = useServerFn(postScheduledNow);
  const cancelAllFn = useServerFn(cancelAllScheduledUploads);
  const runDueFn = useServerFn(runDueUploads);
  const autoScheduleFn = useServerFn(autoScheduleFolder);
  const scheduleSelectedFn = useServerFn(scheduleSelectedVideos);
  const listFolderFn = useServerFn(listDriveFolderVideos);
  const disconnectDriveFn = useServerFn(disconnectDrive);
  const deleteVideoFn = useServerFn(deleteUploadedVideo);
  const autopilotsFn = useServerFn(listAutopilots);
  const setAutopilotFn = useServerFn(setAutopilotEnabled);
  const autopilots = useQuery({
    queryKey: ["yt-autopilots"],
    queryFn: () => autopilotsFn(),
    ...resilient,
  });
  const masterSwitchFn = useServerFn(getAutopilotMasterSwitch);
  const setMasterSwitchFn = useServerFn(setAutopilotMasterSwitch);
  const masterSwitch = useQuery({
    queryKey: ["yt-master-switch"],
    queryFn: () => masterSwitchFn(),
    ...resilient,
  });
  const toggleMaster = useMutation({
    mutationFn: (enabled: boolean) => setMasterSwitchFn({ data: { enabled } }),
    onSuccess: (_r, enabled) => {
      toast.success(
        enabled
          ? "Mode otomatis NYALA — sistem mengatur jadwal dan mengunggah sendiri."
          : "Mode otomatis MATI — semua upload dikerjakan manual.",
      );
      queryClient.invalidateQueries({ queryKey: ["yt-master-switch"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const applyAllFn = useServerFn(applyAutoScheduleAll);
  const applyAll = useMutation({
    mutationFn: () => applyAllFn(),
    onSuccess: (r) => {
      toast.success(`Jam tayang otomatis diterapkan ke ${r.channels.length} channel.`);
      queryClient.invalidateQueries({ queryKey: ["yt-autopilots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const perfFn = useServerFn(getPerformance);
  const refreshStatsFn = useServerFn(refreshVideoStats);
  const perf = useQuery({
    queryKey: ["yt-performance"],
    queryFn: () => perfFn(),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    ...resilient,
  });
  const refreshStats = useMutation({
    mutationFn: () => refreshStatsFn({ data: undefined }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["yt-performance"] });
      if (res.skipped) {
        toast.info("Statistik masih segar, coba lagi sebentar lagi.");
      } else if (res.videos > 0) {
        toast.success(`Statistik disegarkan: ${res.videos} video.`);
      } else {
        toast.info("Belum ada video tayang untuk disegarkan.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleAutopilot = useMutation({
    mutationFn: (v: { channelId: string; enabled: boolean; channelTitle?: string | null }) =>
      setAutopilotFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.enabled ? "Channel dilanjutkan." : "Channel dijeda sementara.");
      queryClient.invalidateQueries({ queryKey: ["yt-autopilots"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [rootFolderUrl, setRootFolderUrl] = useState(DEFAULT_FOLDER_URL);
  const [folderUrl, setFolderUrl] = useState("");
  const [folderName, setFolderName] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("public");
  const [channelId, setChannelId] = useState("");
  const [kind, setKind] = useState<"video" | "reels">("video");
  const [slotTimes, setSlotTimes] = useState("12:00,19:00");
  const MAX_VIDEOS = 1000;
  const [maxVideos, setMaxVideos] = useState("1000");
  const [timezone, setTimezone] = useState("Asia/Makassar");
  const [queue, setQueue] = useState<string[]>([]);
  // Terapkan pengaturan tersimpan sekali saat dimuat, supaya tetap sama setelah remix.
  const [settingsApplied, setSettingsApplied] = useState(false);
  useEffect(() => {
    if (settingsApplied || !settings.data) return;
    setChannelId(settings.data.channelId);
    setKind(settings.data.kind === "reels" ? "reels" : "video");
    setPrivacy(settings.data.privacy || "public");
    if (settings.data.description) setDescription(settings.data.description);
    if (settings.data.slotTimes) setSlotTimes(settings.data.slotTimes);
    setSettingsApplied(true);
  }, [settings.data, settingsApplied]);

  useEffect(() => {
    const first = channels.data?.[0]?.id;
    if (settingsApplied && first && !channelId) setChannelId(first);
  }, [channels.data, channelId, settingsApplied]);

  // ---- Pengaturan per channel: 1 channel = 1 folder Drive + 1 set jadwal ----
  const channelSettingsFn = useServerFn(getChannelSettings);
  const saveChannelSettingsFn = useServerFn(saveChannelSettings);
  const subfoldersFn = useServerFn(listDriveSubfolders);

  const channelSettings = useQuery({
    queryKey: ["channel-settings", channelId],
    queryFn: () => channelSettingsFn({ data: { channelId } }),
    enabled: Boolean(channelId),
    ...resilient,
  });

  useEffect(() => {
    const s = channelSettings.data;
    if (!s || s.channelId !== channelId) return;
    setFolderUrl(s.folderUrl);
    setFolderName(s.folderName ?? "");
    setKind(s.kind);
    setPrivacy(s.privacy);
    setSlotTimes(s.slotTimes);
    setTimezone(s.timezone);
    setDescription(s.description ?? "");
    setQueue([]);
    setSelectedFileId("");
  }, [channelSettings.data, channelId]);

  const subfolders = useQuery({
    queryKey: ["drive-subfolders", rootFolderUrl],
    queryFn: () => subfoldersFn({ data: { parentUrl: rootFolderUrl } }),
    ...resilient,
  });

  const saveChannelPrefs = useMutation({
    mutationFn: (v?: { folderUrl?: string; folderName?: string }) =>
      saveChannelSettingsFn({
        data: {
          channelId,
          channelTitle: channels.data?.find((c) => c.id === channelId)?.title ?? null,
          folderUrl: v?.folderUrl ?? folderUrl,
          folderName: v?.folderName ?? folderName,
          kind,
          privacy,
          slotTimes,
          timezone,
          description,
        },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["channel-settings", channelId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      saveSettingsFn({
        data: {
          channelId,
          channelTitle: channels.data?.find((c) => c.id === channelId)?.title ?? null,
          kind,
          privacy,
          description,
        },
      }),
    onSuccess: () => {
      toast.success("Pengaturan default disimpan.");
      queryClient.invalidateQueries({ queryKey: ["yt-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yt_connected")) {
      toast.success("Akun YouTube berhasil terhubung.");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["yt-status"] }),
        queryClient.invalidateQueries({ queryKey: ["yt-channels"] }),
        queryClient.invalidateQueries({ queryKey: ["yt-autopilots"] }),
        queryClient.invalidateQueries({ queryKey: ["yt-uploads"] }),
      ]);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const err = params.get("yt_error");
    if (err) {
      toast.error(err);
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("drive_connected")) {
      toast.success("Google Drive terhubung.");
      void queryClient.invalidateQueries({ queryKey: ["yt-status"] });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [queryClient]);

  const removeDrive = useMutation({
    mutationFn: () => disconnectDriveFn(),
    onSuccess: () => {
      toast.success("Koneksi Google Drive dilepas.");
      queryClient.invalidateQueries({ queryKey: ["yt-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: (channelId?: string | null) => disconnectFn({ data: { channelId: channelId ?? null } }),
    onSuccess: (_res, channelId) => {
      toast.success(channelId ? "Channel diputus." : "Semua channel diputus.");
      queryClient.invalidateQueries({ queryKey: ["yt-status"] });
      queryClient.invalidateQueries({ queryKey: ["yt-channels"] });
      setChannelId((current) => (!channelId || channelId === current ? "" : current));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const channelTitle = channels.data?.find((c) => c.id === channelId)?.title ?? null;


  const [postingNowId, setPostingNowId] = useState<string | null>(null);
  const [browserOrigin, setBrowserOrigin] = useState("");

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  const youtubeAuthHref = (flow: "youtube" | "drive") => {
    const params = new URLSearchParams({ flow });
    if (browserOrigin) params.set("return_to", browserOrigin);
    return `/api/public/youtube/auth?${params.toString()}`;
  };

  // Halaman Google tidak boleh dimuat di dalam frame, jadi login selalu dibuka
  // di tab baru. Kalau popup diblokir, coba navigasi frame teratas, lalu beri tahu.
  const openAuthFlow =
    (flow: "youtube" | "drive") => (event: MouseEvent<HTMLAnchorElement>) => {
      if (!configured) return;
      event.preventDefault();
      const href = youtubeAuthHref(flow);
      const tab = window.open("", "_blank");
      if (tab) {
        tab.opener = null;
        tab.location.href = href;
        return;
      }
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = href;
          return;
        }
      } catch {
        // frame editor tidak mengizinkan navigasi ke halaman teratas
      }
      window.location.href = href;
      toast.info("Popup diblokir browser. Izinkan popup bila diminta, lalu coba lagi.");
    };

  const uploadFn = useServerFn(uploadFromDrive);
  const [postingFileId, setPostingFileId] = useState<string | null>(null);
  const postVideo = useMutation({
    mutationFn: (f: {
      id: string;
      name: string;
      webViewLink: string;
      channelId?: string;
      channelTitle?: string | null;
    }) => {
      setPostingFileId(f.id);
      const targetId = f.channelId ?? channelId;
      return uploadFn({
        data: {
          driveUrl: f.webViewLink,
          title: f.name.replace(/\.[^.]+$/, ""),
          description: targetId === channelId ? description : "",
          privacy,
          kind,
          channelId: targetId,
          channelTitle: f.channelId ? (f.channelTitle ?? null) : channelTitle,
        },
      });
    },
    onSuccess: (res: { url?: string }) => {
      toast.success(res?.url ? `Video terbit: ${res.url}` : "Video berhasil diposting.");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPostingFileId(null),
  });

  const postNow = useMutation({
    mutationFn: (id: string) => {
      setPostingNowId(id);
      return postNowFn({ data: { id } });
    },
    onSuccess: (res: { url?: string }) => {
      toast.success(res?.url ? `Video terbit: ${res.url}` : "Video berhasil diposting.");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPostingNowId(null),
  });

  const cancelSchedule = useMutation({
    mutationFn: (id: string) => cancelScheduleFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Jadwal dibatalkan.");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelAll = useMutation({
    mutationFn: (channelId: string | null) => cancelAllFn({ data: { channelId } }),
    onSuccess: (res) => {
      toast.success(`${res.deleted} jadwal dihapus.`);
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteVideo = useMutation({
    mutationFn: (id: string) => deleteVideoFn({ data: { id } }),
    onSuccess: (res) => {
      toast.success(res.videoDeleted ? "Video dihapus dari YouTube." : "Riwayat dihapus.");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
      queryClient.invalidateQueries({ queryKey: ["yt-performance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Riwayat upload langsung dari YouTube (playlist uploads channel).
  const fetchHistoryFn = useServerFn(fetchChannelUploadHistory);
  const [ytHistory, setYtHistoryRaw] = useState<Record<string, YoutubeHistoryItem[]>>({});
  // Riwayat yang sudah diambil disimpan permanen di browser sampai dihapus sendiri.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("yt-history-v1");
      if (raw) setYtHistoryRaw(JSON.parse(raw));
    } catch {
      /* abaikan */
    }
  }, []);
  // Muat riwayat permanen dari database (tersedia di perangkat mana pun).
  const savedHistoryFn = useServerFn(listSavedChannelHistory);
  const savedHistoryKey = (channels.data ?? []).map((c) => c.id).join(",");
  useEffect(() => {
    if (!savedHistoryKey) return;
    savedHistoryFn({ data: { channelIds: savedHistoryKey.split(",") } })
      .then((saved) => {
        setYtHistoryRaw((s) => {
          const next = { ...s };
          for (const [ch, items] of Object.entries(saved)) {
            if (items.length > 0) next[ch] = items;
          }
          return next;
        });
      })
      .catch(() => {});
  }, [savedHistoryKey]);
  const setYtHistory = (
    fn: (s: Record<string, YoutubeHistoryItem[]>) => Record<string, YoutubeHistoryItem[]>,
  ) =>
    setYtHistoryRaw((s) => {
      const next = fn(s);
      try {
        window.localStorage.setItem("yt-history-v1", JSON.stringify(next));
      } catch {
        /* abaikan */
      }
      return next;
    });
  const [accMin, setAccMin] = useState(false);
  const [chMin, setChMin] = useState<Record<string, boolean>>({});
  const fetchHistory = useMutation({
    mutationFn: (channelId: string) => fetchHistoryFn({ data: { channelId } }),
    onSuccess: (res, channelId) => {
      setYtHistory((s) => ({ ...s, [channelId]: res.items }));
      toast.success(`${res.items.length} riwayat upload diambil dari YouTube.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteYtFn = useServerFn(deleteChannelVideo);
  const deleteYt = useMutation({
    mutationFn: (v: { channelId: string; videoId: string }) => deleteYtFn({ data: v }),
    onSuccess: (_r, v) => {
      setYtHistory((s) => ({
        ...s,
        [v.channelId]: (s[v.channelId] ?? []).filter((x) => x.videoId !== v.videoId),
      }));
      toast.success("Video dihapus dari channel.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Analisis potensi viral video di folder Drive (penilaian AI).
  const analyzeViralFn = useServerFn(analyzeFolderViralPotential);
  const deleteDriveFn = useServerFn(deleteDriveVideos);
  const listViralFn = useServerFn(listViralRatings);
  const channelIdsKey = (channels.data ?? []).map((c) => c.id).join(",");
  const savedViral = useQuery({
    queryKey: ["viral-ratings", channelIdsKey],
    queryFn: () => listViralFn({ data: { channelIds: channelIdsKey ? channelIdsKey.split(",") : [] } }),
    enabled: Boolean(channelIdsKey),
    refetchInterval: 60_000,
  });
  const [viralLocal, setViral] = useState<Record<string, ViralItem[]>>({});
  const viral: Record<string, ViralItem[]> = { ...(savedViral.data?.byChannel ?? {}), ...viralLocal };
  const [viralMin, setViralMin] = useState<Record<string, boolean>>({});
  const analyzeViral = useMutation({
    mutationFn: (v: { channelId: string; channelTitle: string | null; folderUrl: string }) =>
      analyzeViralFn({
        data: {
          folderUrl: v.folderUrl,
          channelId: v.channelId,
          channelTitle: v.channelTitle,
          exactFolder: true,
        },
      }),
    onSuccess: (res, v) => {
      setViral((s) => ({ ...s, [v.channelId]: res.items }));
      const bad = res.items.filter((i) => i.verdict === "tidak");
      toast.success(
        `${res.items.length} video dinilai: ${res.items.length - bad.length} berpotensi, ${bad.length} tidak berpotensi.`,
      );
      // Langsung hapus permanen video tidak berpotensi dari Drive + sistem.
      if (bad.length > 0) {
        deleteViral.mutate({ channelId: v.channelId, fileIds: bad.map((b) => b.fileId) });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteViral = useMutation({
    mutationFn: (v: { channelId: string; fileIds: string[] }) =>
      deleteDriveFn({ data: { fileIds: v.fileIds, channelId: v.channelId } }),
    onSuccess: (res, v) => {
      setViral((s) => ({
        ...s,
        [v.channelId]: (s[v.channelId] ?? []).filter((x) => !v.fileIds.includes(x.fileId)),
      }));
      toast.success(
        `${res.deleted} video tidak berpotensi dihapus dari Google Drive.${res.failed ? ` ${res.failed} gagal.` : ""}`,
      );
      queryClient.invalidateQueries({ queryKey: ["channel-videos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const autoSchedule = useMutation({
    mutationFn: () =>
      autoScheduleFn({
        data: {
          folderUrl,
          exactFolder: true,
          channelId,
          channelTitle,
          kind,
          privacy,
          slotTimes,
          timezone,
          maxVideos: Number(maxVideos) || 1000,
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
          exactFolder: true,
          fileIds: queue,
          channelId,
          channelTitle,
          kind,
          privacy,
          slotTimes,
          timezone,
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

  // Jalankan jadwal yang jatuh tempo saat halaman terbuka (selain cron eksternal).
  // Urutkan jadwal dari atas ke bawah: yang paling cepat diupload paling atas.
  const timeOf = (s: string | null) => (s ? new Date(s).getTime() : Number.POSITIVE_INFINITY);
  const scheduledItems = (uploads.data ?? [])
    .filter((u) => u.status === "scheduled")
    .sort((a, b) => timeOf(a.scheduled_at) - timeOf(b.scheduled_at));
  // Kelompokkan jadwal per channel supaya daftar tetap ringkas.
  // Kelompokkan per channel (bukan per nama), supaya 2 channel bernama sama tidak menyatu.
  const scheduleGroups = Array.from(
    scheduledItems
      .reduce((map, item) => {
        const key = item.channel_id ?? "tanpa-channel";
        const liveTitle = channels.data?.find((c) => c.id === item.channel_id)?.title;
        const group =
          map.get(key) ?? {
            key,
            title: liveTitle ?? item.channel_title ?? "Tanpa channel",
            items: [] as typeof scheduledItems,
          };
        group.items.push(item);
        map.set(key, group);
        return map;
      }, new Map<string, { key: string; title: string; items: typeof scheduledItems }>())
      .values(),
  )
    .map((g, _i, all) => ({
      ...g,
      title:
        all.filter((x) => x.title === g.title).length > 1
          ? `${g.title} (${g.key.slice(-4)})`
          : g.title,
    }))
    // Channel dengan jadwal paling dekat tampil paling atas.
    .sort(
      (a, b) =>
        timeOf(a.items[0]?.scheduled_at ?? null) - timeOf(b.items[0]?.scheduled_at ?? null),
    );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [itemPages, setItemPages] = useState<Record<string, number>>({});
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const HISTORY_PER_PAGE = 10;
  const [historyPage, setHistoryPage] = useState(0);
  const [historyItemPages, setHistoryItemPages] = useState<Record<string, number>>({});

  // Paginasi daftar Jadwal upload: tampilkan 10 channel per halaman.
  const SCHEDULE_PER_PAGE = 10;
  const schedulePageCount = Math.max(1, Math.ceil(scheduleGroups.length / SCHEDULE_PER_PAGE));
  const [schedulePage, setSchedulePage] = useState(0);
  useEffect(() => {
    if (schedulePage > schedulePageCount - 1) setSchedulePage(schedulePageCount - 1);
  }, [schedulePage, schedulePageCount]);
  const visibleScheduleGroups = scheduleGroups.slice(
    schedulePage * SCHEDULE_PER_PAGE,
    schedulePage * SCHEDULE_PER_PAGE + SCHEDULE_PER_PAGE,
  );


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

  // Penghitung waktu tersisa (live tiap detik).
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (scheduledItems.length === 0) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [scheduledItems.length]);

  const formatRemaining = (iso: string | null) => {
    if (!iso) return null;
    let diff = Math.floor((new Date(iso).getTime() - nowTs) / 1000);
    if (diff <= 0) return "sedang diproses…";
    const d = Math.floor(diff / 86400);
    diff %= 86400;
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    const parts = [
      d > 0 ? `${d}h` : null,
      d > 0 || h > 0 ? `${h}j` : null,
      `${m}m`,
      d > 0 ? null : `${s}d`,
    ].filter(Boolean);
    return `${parts.join(" ")} lagi`;
  };




  const allFoldersFn = useServerFn(listChannelFolders);
  const setFolderFn = useServerFn(setChannelFolder);
  const allFolders = useQuery({
    queryKey: ["channel-folders"],
    queryFn: () => allFoldersFn(),
    ...resilient,
  });
  const saveRowFolder = useMutation({
    mutationFn: (v: { channelId: string; channelTitle: string | null; folderUrl: string; folderName: string }) =>
      setFolderFn({ data: v }),
    onSuccess: (r, v) => {
      const n = (r as { sync?: { scheduled?: number } }).sync?.scheduled ?? 0;
      toast.success(
        `Folder disimpan untuk ${v.channelTitle ?? "channel"}. ${n > 0 ? `${n} video masuk Jadwal upload.` : "Channel masuk Jadwal upload."}`,
      );
      queryClient.invalidateQueries({ queryKey: ["channel-folders"] });
      queryClient.invalidateQueries({ queryKey: ["channel-settings", v.channelId] });
      queryClient.invalidateQueries({ queryKey: ["yt-autopilots"] });
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const browseFolder = useMutation({
    mutationFn: (arg: string | { url: string; channelId: string; channelTitle: string | null }) =>
      typeof arg === "string"
        ? listFolderFn({ data: { folderUrl: arg, channelId, channelTitle, exactFolder: true } })
        : listFolderFn({
            data: {
              folderUrl: arg.url,
              channelId: arg.channelId,
              channelTitle: arg.channelTitle,
              exactFolder: true,
            },
          }),
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
  };

  const usedFileIds = new Set(
    (uploads.data ?? [])
      .filter((u) => ["scheduled", "uploading", "done"].includes(u.status))
      .map((u) => u.drive_file_id)
      .filter(Boolean) as string[],
  );
  const fileLabels = new Map<string, string>();
  for (const u of uploads.data ?? []) {
    if (!u.drive_file_id) continue;
    if (u.status === "done") fileLabels.set(u.drive_file_id, "sudah diposting");
    else if (u.status === "uploading" && !fileLabels.has(u.drive_file_id))
      fileLabels.set(u.drive_file_id, "sedang diunggah");
    else if (u.status === "scheduled" && !fileLabels.has(u.drive_file_id))
      fileLabels.set(
        u.drive_file_id,
        u.scheduled_at
          ? `terjadwal ${new Date(u.scheduled_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
          : "terjadwal",
      );
  }
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


  const connected = status.data?.connected ?? false;
  const configured = status.data?.configured ?? false;
  const accounts = status.data?.accounts ?? [];
  const driveConnected = status.data?.driveConnected ?? false;
  const requiredRedirectUri = status.data?.redirectUri ?? "";

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <Toaster />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-80"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl space-y-6">
        <nav className="flex items-center justify-between rounded-2xl border border-border bg-card/60 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl text-primary-foreground" style={{ background: "var(--gradient-primary)" }}><Youtube className="size-5" /></span>
            <div className="leading-tight">
              <p className="font-bold tracking-tight" style={{ fontFamily: "Space Grotesk" }}>DriveTube Studio</p>
              <p className="text-xs text-muted-foreground">Drive → YouTube otomatis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs sm:inline-flex ${connected ? "border-accent/40 text-accent" : "border-border text-muted-foreground"}`}>
              <span className={`size-2 rounded-full ${connected ? "animate-pulse bg-accent" : "bg-muted-foreground"}`} />
              {connected ? `${accounts.length} channel aktif` : "Belum terhubung"}
            </span>
            <Button asChild size="sm" variant="secondary"><Link to="/riwayat"><History className="size-4" /> Riwayat</Link></Button>
            <Button asChild size="sm" variant="secondary"><Link to="/laporan"><History className="size-4" /> Laporan</Link></Button>
          </div>
        </nav>

        <header className="relative grid items-center gap-6 overflow-hidden rounded-3xl border border-border bg-card p-6 md:grid-cols-[1.4fr_1fr] md:p-10" style={{ boxShadow: "var(--shadow-panel)" }}>
          <div className="pointer-events-none absolute -top-32 -left-20 size-96 rounded-full bg-primary/25 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -right-20 -bottom-32 size-80 rounded-full bg-accent/15 blur-3xl" aria-hidden />
          <div className="relative space-y-4 text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold tracking-widest text-primary uppercase">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" /> Studio Otomasi
            </div>
            <h1 className="text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">Dari <span className="text-gold">Drive</span><br />langsung tayang di <span className="text-gold">YouTube</span></h1>
            <p className="max-w-lg text-muted-foreground">Tempel link Google Drive publik, atur jadwal, dan biarkan sistem mengunggah ke semua channel Anda.</p>
          </div>
          <div className="relative grid grid-cols-2 gap-3">
            {[
              { i: Youtube, k: "Channel", v: String(accounts.length) },
              { i: UploadCloud, k: "Upload", v: String(uploads.data?.length ?? 0) },
              { i: CalendarClock, k: "Terjadwal", v: "Auto" },
              { i: Sparkles, k: "Analisis", v: "AI" },
            ].map(({ i: I, k, v }) => (
              <div key={k} className="rounded-2xl border border-border bg-secondary/50 p-4 transition-transform hover:-translate-y-1">
                <I className="mb-3 size-5 text-accent" />
                <p className="text-2xl font-bold" style={{ fontFamily: "Space Grotesk" }}>{v}</p>
                <p className="text-xs text-muted-foreground">{k}</p>
              </div>
            ))}
          </div>
        </header>

        <section className="rounded-2xl border border-border bg-card p-6" style={{ boxShadow: "var(--shadow-panel)" }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-medium"><CalendarClock className="size-5 text-accent" /> Jadwal otomatis semua channel</h2>
              <p className="text-sm text-muted-foreground">Jam tayang tiap channel dipilih otomatis dari analisis penonton dan diperbarui sendiri setiap hari. Channel yang datanya belum cukup memakai jam cadangan.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={masterSwitch.data?.enabled ?? true ? "default" : "secondary"}
                onClick={() => toggleMaster.mutate(!(masterSwitch.data?.enabled ?? true))}
                disabled={toggleMaster.isPending}
              >
                Mode otomatis: {masterSwitch.data?.enabled ?? true ? "NYALA" : "MATI"}
              </Button>
              <Button variant="secondary" onClick={() => applyAll.mutate()} disabled={applyAll.isPending}>
                {applyAll.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Terapkan ke semua channel sekarang
              </Button>
            </div>
          </div>
          {(autopilots.data ?? []).length > 0 && (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(autopilots.data ?? []).map((ap) => (
                <li key={ap.channel_id} className="rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm">
                  <p className="truncate font-medium">{ap.channel_title ?? ap.channel_id}</p>
                  <p className="text-xs text-muted-foreground">Jam tayang: {ap.slot_times.split(",").join(" · ")}{ap.enabled ? "" : " (dijeda)"}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-6">





        <section
          className="rounded-2xl border border-border bg-card p-6"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <button type="button" className="flex items-center gap-1 text-left" onClick={() => setAccMin((v) => !v)} aria-expanded={!accMin}>
                  <ChevronDown className={`size-4 transition-transform ${accMin ? "-rotate-90" : ""}`} />
                  <h2 className="text-lg font-medium">Akun YouTube</h2>
                </button>
                <p className="text-sm text-muted-foreground">
                  {!configured
                    ? "Kredensial Google OAuth belum diatur."
                    : connected
                      ? `${accounts.length} channel terhubung`
                      : "Belum terhubung"}
                </p>
                {status.data?.redirectUri && (
                  <p className={`mt-2 text-xs text-muted-foreground ${accMin ? "hidden" : ""}`}>
                    Redirect URI yang harus terdaftar di Google Cloud Console:{" "}
                    <code className="break-all rounded bg-muted px-1 py-0.5">
                      {status.data.redirectUri}
                    </code>
                  </p>
                )}
              </div>

              <div className={`flex flex-wrap gap-2 ${accMin ? "hidden" : ""}`}>
                <Button
                  asChild
                  variant={connected ? "secondary" : "default"}
                  disabled={!configured}
                >
                  <a
                    href={configured ? youtubeAuthHref("youtube") : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={openAuthFlow("youtube")}
                    aria-disabled={!configured}
                  >
                    {connected ? <Plus className="size-4" /> : <Youtube className="size-4" />}
                    {connected ? "Tambah channel lain" : "Login YouTube"}
                  </a>
                </Button>
                {connected && (
                  <Button variant="ghost" onClick={() => disconnect.mutate(null)}>
                    <LogOut className="size-4" /> Putuskan semua
                  </Button>
                )}
              </div>
            </div>

            <div className={`space-y-2 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground ${accMin ? "hidden" : ""}`}>
              <p className="font-medium text-foreground">
                Error 400: redirect_uri_mismatch? Tambahkan URI di bawah ke
                “Authorized redirect URIs” pada OAuth Client Google Cloud Console, lalu coba
                login lagi.
              </p>
              <ul className="space-y-1">
                {[requiredRedirectUri]
                  .filter((u): u is string => Boolean(u))
                  .filter((u, i, arr) => arr.indexOf(u) === i)
                  .map((uri) => (
                    <li key={uri} className="flex items-center gap-2">
                      <code className="break-all">{uri}</code>
                    </li>
                  ))}
              </ul>
              <Button
                size="sm"
                variant="secondary"
                disabled={!requiredRedirectUri}
                onClick={() => {
                  void navigator.clipboard.writeText(requiredRedirectUri);
                  toast.success("URI disalin");
                }}
              >
                Salin URI
              </Button>
            </div>





            {accounts.length > 0 && (
              <ul className={`space-y-2 ${accMin ? "hidden" : ""}`}>
                {accounts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-2"
                  >
                    <span className="truncate text-sm">{a.title ?? a.id}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => disconnect.mutate(a.id)}
                    >
                      Putuskan
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2 border-t border-border pt-4">
              <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 ${accMin ? "hidden" : ""}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Google Drive</p>
                  <p className="text-xs text-muted-foreground">
                    {driveConnected
                      ? "Izin Drive aktif — folder & file privat bisa dibaca."
                      : "Belum ada izin Drive. Hubungkan dengan akun Google biasa (bukan Brand Account)."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    asChild
                    size="sm"
                    variant={driveConnected ? "secondary" : "default"}
                    disabled={!configured}
                  >
                    <a
                      href={configured ? youtubeAuthHref("drive") : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={openAuthFlow("drive")}
                      aria-disabled={!configured}
                    >
                      <FolderOpen className="size-4" />
                      {driveConnected ? "Hubungkan ulang" : "Hubungkan Google Drive"}
                    </a>
                  </Button>
                  {driveConnected && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={removeDrive.isPending}
                      onClick={() => removeDrive.mutate()}
                    >
                      Lepas
                    </Button>
                  )}
                </div>
              </div>

              <Label>Langkah 1 — Pilih channel tujuan</Label>
              <Select value={channelId} onValueChange={setChannelId} disabled={!connected}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      channels.isLoading ? "Memuat channel…" : "Pilih channel YouTube"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {channels.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {connected && (
                <p className="text-xs text-muted-foreground">
                  Channel lain belum muncul? Klik "Tambah channel lain" lalu pilih akun/channel
                  tersebut saat login Google.
                </p>
              )}
            </div>
          </div>
        </section>
        </div>
        <div className="min-w-0 space-y-6">

        <section
          className="space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-6"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="space-y-2">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label>Langkah 2 — Folder, video & riwayat tiap channel</Label>
              <Button
                size="sm"
                variant="outline"
                disabled={refreshStats.isPending}
                onClick={() => refreshStats.mutate()}
              >
                {refreshStats.isPending ? <Loader2 className="size-4 animate-spin" /> : <Clock className="size-4" />}
                Segarkan statistik
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Semua channel yang terhubung beserta folder Drive-nya. Ganti folder langsung di
              tiap baris (otomatis tersimpan), lalu klik "Buka video" untuk memposting.
            </p>
            {!connected || (channels.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada channel yang terhubung.</p>
            ) : (
              <ul className="space-y-4">
                <li className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setChMin({})}>
                    Buka semua
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setChMin(Object.fromEntries((channels.data ?? []).map((c) => [c.id, true])))}
                  >
                    Tutup semua
                  </Button>
                </li>
                 {(channels.data ?? []).map((c, idx) => {
                  const tint = [
                    "bg-chart-1/10 border-l-chart-1",
                    "bg-chart-2/10 border-l-chart-2",
                    "bg-chart-3/20 border-l-chart-3",
                    "bg-chart-4/10 border-l-chart-4",
                    "bg-chart-5/10 border-l-chart-5",
                  ][idx % 5];
                  const saved = allFolders.data?.find((f) => f.channelId === c.id);
                  const url = saved?.folderUrl ?? "";
                  const name = saved?.folderName ?? "";
                   const active = c.id === channelId;
                   const options = subfolders.data?.folders ?? [];
                   const ap = (autopilots.data ?? []).find(
                     (a: { channel_id?: string; enabled?: boolean }) => a.channel_id === c.id,
                   );
                   const autopilotOn = ap?.enabled ?? false;
                  return (
                    <li
                      key={c.id}
                      className={`grid grid-cols-1 items-center gap-3 rounded-xl border-2 border-l-4 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:border-l-8 sm:px-4 sm:py-4 ${tint} ${active ? "border-t-primary border-r-primary border-b-primary" : "border-t-border border-r-border border-b-border"} ${chMin[c.id] ? "[&>*:not(:first-child)]:hidden" : ""}`}
                    >
                       <div className="min-w-0">
                         <button
                           type="button"
                           className="flex w-full min-w-0 items-center gap-1 text-left"
                           onClick={() => setChMin((m) => ({ ...m, [c.id]: !m[c.id] }))}
                           aria-expanded={!chMin[c.id]}
                         >
                           <ChevronDown
                             className={`size-4 shrink-0 transition-transform ${chMin[c.id] ? "-rotate-90" : ""}`}
                           />
                           <span className="truncate text-sm font-medium">{c.title}</span>
                         </button>
                         <p className="truncate text-xs text-muted-foreground">
                           {url ? `Folder: ${name || "folder pilihan"}` : "Belum ada folder"}
                         </p>
                         <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                           <Switch
                             checked={autopilotOn}
                             disabled={autopilots.isLoading || toggleAutopilot.isPending}
                             onCheckedChange={(on) =>
                               toggleAutopilot.mutate({
                                 channelId: c.id,
                                 channelTitle: c.title,
                                 enabled: on,
                               })
                             }
                           />
                           Autopilot {autopilotOn ? "aktif" : "jeda"}
                         </label>
                       </div>
                      <Select
                        value={url}
                        onValueChange={(value) => {
                          const picked = options.find((f) => f.webViewLink === value);
                          const fname = picked?.name ?? "";
                          saveRowFolder.mutate({
                            channelId: c.id,
                            channelTitle: c.title,
                            folderUrl: value,
                            folderName: fname,
                          });
                          if (active) {
                            setFolderUrl(value);
                            setFolderName(fname);
                            setQueue([]);
                            setSelectedFileId("");
                            browseFolder.mutate(value);
                          }
                        }}
                      >
                        <SelectTrigger className="min-w-0">
                          <SelectValue
                            placeholder={
                              subfolders.isLoading
                                ? "Memuat folder…"
                                : subfolders.data?.needsAuth
                                  ? "Hubungkan Google Drive dulu"
                                  : "Pilih folder"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {url && !options.some((f) => f.webViewLink === url) && (
                            <SelectItem value={url}>{name || "Folder tersimpan"}</SelectItem>
                          )}
                          {options.map((f) => (
                            <SelectItem key={f.id} value={f.webViewLink}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        className="w-full shrink-0 sm:w-auto"
                        disabled={!url || browseFolder.isPending}
                        onClick={() => {
                          setChannelId(c.id);
                          setFolderUrl(url);
                          setFolderName(name);
                          setQueue([]);
                          setSelectedFileId("");
                          browseFolder.mutate({ url, channelId: c.id, channelTitle: c.title });
                        }}
                      >
                        {browseFolder.isPending && active ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <FolderOpen className="size-4" />
                        )}
                        Buka video
                      </Button>
                      {url && (
                        <div className="sm:col-span-3">
                          <ChannelVideoList
                            folderUrl={url}
                            channelId={c.id}
                            channelTitle={c.title}
                            usedFileIds={usedFileIds}
                            fileLabels={fileLabels}
                            listFn={listFolderFn}
                            postingFileId={postingFileId}
                            disabled={!connected || postVideo.isPending}
                            onPost={(f) =>
                              postVideo.mutate({ ...f, channelId: c.id, channelTitle: c.title })
                            }
                          />
                        </div>
                      )}
                      {url && (
                        <div className="space-y-1 sm:col-span-3">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                              onClick={() => setViralMin((m) => ({ ...m, [c.id]: !m[c.id] }))}
                              aria-expanded={!viralMin[c.id]}
                            >
                              <ChevronDown
                                className={`size-3.5 transition-transform ${viralMin[c.id] ? "-rotate-90" : ""}`}
                              />
                              Potensi viral (penilaian AI)
                              {viralMin[c.id] && (viral[c.id]?.length ?? 0) > 0
                                ? ` · ${viral[c.id]!.length} video`
                                : ""}
                            </button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0 px-2 text-xs"
                              disabled={analyzeViral.isPending}
                              onClick={() =>
                                analyzeViral.mutate({
                                  channelId: c.id,
                                  channelTitle: c.title,
                                  folderUrl: url,
                                })
                              }
                            >
                              {analyzeViral.isPending && analyzeViral.variables?.channelId === c.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                              Nilai potensi
                            </Button>
                          </div>
                          {(() => {
                            if (viralMin[c.id]) return null;
                            const vItems: ViralItem[] = viral[c.id] ?? [];
                            if (vItems.length === 0) return null;
                            const bad = vItems.filter((i) => i.verdict === "tidak");
                            return (
                              <>
                                <ul className="divide-y divide-border rounded-lg border border-border">
                                  {vItems.map((v) => (
                                    <li
                                      key={v.fileId}
                                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5"
                                    >
                                      <span
                                        className={`h-2 w-2 shrink-0 rounded-full ${v.verdict === "berpotensi" ? "bg-green-500" : "bg-red-500"}`}
                                        aria-hidden
                                      />
                                      <a
                                        className="min-w-0 flex-1 truncate text-xs hover:underline"
                                        href={v.webViewLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={v.name}
                                      >
                                        {v.name}
                                      </a>
                                      <span className="w-full min-w-0 break-words pl-4 text-xs text-muted-foreground sm:w-auto sm:max-w-[50%] sm:pl-0">
                                        {v.reason}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                                {bad.length > 0 && deleteViral.isPending && (
                                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Loader2 className="size-3.5 animate-spin" />
                                    Menghapus {bad.length} video tidak berpotensi…
                                  </p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                      {(() => {
                        const items = (uploads.data ?? []).filter(
                          (u) => u.channel_id === c.id && u.status !== "scheduled",
                        );
                        const nf = (n: number) => n.toLocaleString("id-ID");
                        const ytItems: YoutubeHistoryItem[] = ytHistory[c.id] ?? [];
                        const sysVideoIds = new Set(items.map((i) => i.video_id).filter(Boolean));
                        const ytOnly = ytItems.filter((v) => !sysVideoIds.has(v.videoId));
                        const statMap = new Map(
                          (perf.data?.videos ?? []).map((v) => [v.video_id, v]),
                        );
                        const ch = (perf.data?.channels ?? []).find((x) => x.channel_id === c.id);
                        const totalViews = items.reduce(
                          (s, i) => s + Number((i.video_id && statMap.get(i.video_id)?.views) || 0),
                          0,
                        );
                        return (
                          <div className="space-y-1 sm:col-span-3">
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                className="flex min-w-0 items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                                aria-expanded={!!openHistory[c.id]}
                                onClick={() => setOpenHistory((s) => ({ ...s, [c.id]: !s[c.id] }))}
                              >
                                <ChevronDown className={`size-3.5 shrink-0 transition-transform ${openHistory[c.id] ? "" : "-rotate-90"}`} />
                                <span className="truncate">
                                  Riwayat upload ({items.length + ytOnly.length}) • {nf(totalViews)} view
                                  {ch ? ` • ${nf(Number(ch.subscribers))} subscriber` : ""}
                                </span>
                              </button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 shrink-0 px-2 text-xs"
                                disabled={fetchHistory.isPending}
                                onClick={() => {
                                  setOpenHistory((s) => ({ ...s, [c.id]: true }));
                                  fetchHistory.mutate(c.id);
                                }}
                              >
                                {fetchHistory.isPending && fetchHistory.variables === c.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <History className="size-3.5" />
                                )}
                                Ambil riwayat
                              </Button>
                            </div>
                            {!openHistory[c.id] ? null : items.length + ytOnly.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Belum ada riwayat.</p>
                            ) : (
                              <ul className="divide-y sm:max-h-56 divide-border rounded-lg border border-border sm:overflow-y-auto">
                                {items.map((item) => {
                                  const stat = item.video_id ? statMap.get(item.video_id) : undefined;
                                  return (
                                    <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5">
                                      {item.status === "done" ? (
                                        <CheckCircle2 className="size-3.5 shrink-0 text-accent" />
                                      ) : item.status === "error" ? (
                                        <XCircle className="size-3.5 shrink-0 text-destructive" />
                                      ) : (
                                        <UploadCloud className="size-3.5 shrink-0 text-muted-foreground" />
                                      )}
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm">{item.title}</span>
                                        <span className="block text-[11px] text-muted-foreground">
                                          {new Date(item.published_at ?? item.created_at).toLocaleString("id-ID", {
                                            day: "2-digit",
                                            month: "short",
                                            year: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })}
                                        </span>
                                      </span>
                                      {item.status === "done" && item.video_id ? (
                                        <span className="order-last flex w-full flex-wrap items-center gap-x-2 pl-5 text-xs text-muted-foreground sm:order-none sm:w-auto sm:pl-0">
                                          <span>
                                            {nf(Number(stat?.views ?? 0))} view • {nf(Number(stat?.likes ?? 0))} like • {nf(Number(stat?.comments ?? 0))} komentar
                                          </span>
                                          <a
                                            className="underline"
                                            href={`https://youtu.be/${item.video_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            Lihat
                                          </a>
                                        </span>
                                      ) : (
                                        <span className="order-last w-full truncate pl-5 text-xs text-muted-foreground sm:order-none sm:w-auto sm:max-w-[40%] sm:pl-0">
                                          {item.error ?? item.status}
                                        </span>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 shrink-0 px-2 text-destructive"
                                        disabled={deleteVideo.isPending}
                                        onClick={() => {
                                          const msg = item.video_id
                                            ? `Hapus "${item.title}"? Video juga akan dihapus permanen dari YouTube.`
                                            : `Hapus "${item.title}" dari riwayat?`;
                                          if (confirm(msg)) deleteVideo.mutate(item.id);
                                        }}
                                      >
                                        {deleteVideo.isPending && deleteVideo.variables === item.id
                                          ? "Menghapus…"
                                          : "Hapus"}
                                      </Button>
                                    </li>
                                  );
                                })}
                                {ytOnly.map((v) => (
                                  <li key={`yt-${v.videoId}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5">
                                    <Youtube className="size-3.5 shrink-0 text-primary" />
                                    <span className="min-w-0 flex-1">
                                      <a className="block truncate text-sm hover:underline" href={`https://youtu.be/${v.videoId}`} target="_blank" rel="noopener noreferrer" title={v.title}>
                                        {v.title}
                                      </a>
                                      <span className="block text-[11px] text-muted-foreground">
                                        {new Date(v.publishedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                    </span>
                                    <span className="order-last flex w-full flex-wrap items-center gap-x-2 pl-5 text-xs text-muted-foreground sm:order-none sm:w-auto sm:pl-0">
                                      <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" />{nf(v.views)}</span>
                                      <span className="inline-flex items-center gap-0.5"><ThumbsUp className="h-3 w-3" />{nf(v.likes)}</span>
                                      <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{nf(v.comments)}</span>
                                    </span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 shrink-0 px-2 text-destructive"
                                      disabled={deleteYt.isPending}
                                      onClick={() => {
                                        if (confirm(`Hapus "${v.title}" dari channel YouTube? Tindakan ini permanen.`))
                                          deleteYt.mutate({ channelId: c.id, videoId: v.videoId });
                                      }}
                                    >
                                      Hapus
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })()}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        </div>
        </div>




      </div>
    </main>
  );
}

type DriveVideo = {
  id: string;
  name: string;
  webViewLink: string;
  size?: number | null;
  thumbnail?: string | null;
};

function ChannelVideoList(props: {
  folderUrl: string;
  channelId: string;
  channelTitle: string | null;
  usedFileIds: Set<string>;
  fileLabels?: Map<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listFn: (args: any) => Promise<any>;
  postingFileId: string | null;
  disabled: boolean;
  onPost: (f: DriveVideo) => void;
}) {
  const q = useQuery({
    queryKey: ["channel-videos", props.channelId, props.folderUrl],
    queryFn: () =>
      props.listFn({
        data: {
          folderUrl: props.folderUrl,
          channelId: props.channelId,
          channelTitle: props.channelTitle,
          exactFolder: true,
        },
      }),
    staleTime: 60_000,
    retry: 1,
  });
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Memuat video…</p>;
  if (q.isError) return <p className="text-xs text-destructive">Gagal memuat video.</p>;
  if (q.data?.needsAuth)
    return <p className="text-xs text-muted-foreground">Hubungkan Google Drive dulu.</p>;
  const videos: DriveVideo[] = q.data?.videos ?? [];
  if (videos.length === 0)
    return <p className="text-xs text-muted-foreground">Tidak ada video di folder ini.</p>;
  return (
    <ul className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:mx-0 sm:grid sm:max-h-[28rem] sm:grid-cols-3 sm:overflow-x-visible sm:overflow-y-auto sm:rounded-lg sm:border sm:border-border sm:p-2 lg:grid-cols-4">
      {videos.map((f) => {
        const used = props.usedFileIds.has(f.id);
        const posting = props.postingFileId === f.id;
        return (
          <li key={f.id} className="flex w-[70%] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-background sm:w-auto">
            <div className="relative aspect-video shrink-0 overflow-hidden bg-muted">
              {f.thumbnail ? (
                <img
                  src={f.thumbnail}
                  alt={f.name}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className={`size-full object-cover ${used ? "opacity-40" : ""}`}
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <Film className="size-8 text-muted-foreground" />
                </div>
              )}
              {used && (
                <span className="absolute top-1 left-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {props.fileLabels?.get(f.id) ?? "sudah diposting"}
                </span>
              )}
              {f.size != null && (
                <span className="absolute right-1 bottom-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
              <p
                className={`line-clamp-2 text-xs ${used ? "text-muted-foreground line-through" : ""}`}
                title={f.name}
              >
                {f.name}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-auto w-full"
                disabled={props.disabled || used}
                onClick={() => props.onPost(f)}
              >
                {posting ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                {posting ? "Memposting…" : "Posting"}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
