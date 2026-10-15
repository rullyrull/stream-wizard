/**
 * Server-only: buat judul & deskripsi YouTube yang lebih menarik dengan AI,
 * berdasarkan nama file di Google Drive dan konteks channel.
 * Kalau AI gagal / tidak tersedia, pemanggil memakai judul bawaan.
 */


export type AiMeta = { title: string; description: string; tags: string[]; hashtags?: string[]; source?: string };

function cleanFileName(name: string) {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateVideoMetadata(input: {
  fileName: string;
  channelTitle: string | null;
  kind: "video" | "reels";
  /** Ringkasan pola yang terbukti berhasil di channel ini (hasil analisa performa). */
  guidance?: string | null;
}): Promise<AiMeta | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;

  const topic = cleanFileName(input.fileName);
  const prompt = [
    `Kamu editor konten YouTube berbahasa Indonesia untuk channel dakwah "${input.channelTitle ?? "-"}".`,
    `Topik video (dari nama file): "${topic}".`,
    input.kind === "reels"
      ? "Format: YouTube Shorts vertikal, durasi pendek."
      : "Format: video biasa.",
    input.guidance
      ? `Pelajaran dari performa video channel ini (WAJIB diikuti):\n${input.guidance}`
      : "",
    "Buat metadata SEO yang natural dan mengundang klik, TANPA clickbait berlebihan, TANPA huruf kapital semua, TANPA kata 'viral/fyp/trending'.",
    "Deskripsi: kalimat pertama berupa hook yang memancing rasa penasaran, lalu 1-2 kalimat menjelaskan isi (sebut nama ustadz/tokoh bila ada di topik, dan kata kunci yang biasa dicari orang), tutup dengan ajakan singkat menonton sampai habis, like, share, dan subscribe. Tanpa hashtag di deskripsi.",
    "tags: 8-10 kata kunci pencarian populer (boleh frasa) yang benar-benar dicari orang di YouTube untuk topik ini.",
    "hashtags: tepat 4 hashtag populer sesuai niche (misal dakwah: kajianislam, ceramahsingkat, dakwahislam, ustadzabdulsomad; kesehatan: tipssehat, hidupsehat, kesehatan, faktakesehatan). Satu kata tanpa spasi, tanpa '#', JANGAN potongan kata umum dari judul seperti 'bumi', 'ibu', 'salah', 'stop'.",
    "source: analisis dari mana video ini berasal — nama penceramah/narasumber asli (contoh: 'Ustadz Adi Hidayat', 'dr. Zaidul Akbar') dan jenis acaranya bila tersirat (kajian, ceramah, podcast, wawancara). Gunakan hanya nama yang tersirat dari topik atau nama channel; jangan mengarang nama acara, tanggal, atau link. Kosongkan string bila benar-benar tidak bisa ditentukan.",
    "Balas HANYA JSON dengan bentuk:",
    '{"title": "judul maksimal 80 karakter", "description": "3-4 kalimat", "tags": ["..."], "hashtags": ["a","b","c","d"], "source": "contoh: Kajian Ustadz Adi Hidayat"}',
  ].filter(Boolean).join("\n");


  try {
    const { aiText } = await import("./analytics.server");
    const raw = (await aiText(prompt)) ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as Partial<AiMeta>;
    const title = (parsed.title ?? "").trim();
    if (!title) return null;

    return {
      title: title.slice(0, 95),
      description: (parsed.description ?? "").trim().slice(0, 3000),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 10)
        : [],
      hashtags: Array.isArray(parsed.hashtags)
        ? parsed.hashtags.filter((t): t is string => typeof t === "string").slice(0, 4)
        : [],
      source: typeof parsed.source === "string" ? parsed.source.trim().slice(0, 150) : "",
    };
  } catch (err) {
    console.error("AI metadata error:", err);
    return null;
  }
}
