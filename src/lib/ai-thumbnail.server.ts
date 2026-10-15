/**
 * Server-only: buat thumbnail mencolok dengan AI lalu pasang ke video YouTube.
 * Gagal secara diam-diam (mengembalikan pesan) — upload tetap dianggap sukses.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function generateThumbnail(title: string): Promise<Uint8Array | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-lite-image",
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: `Buat thumbnail YouTube 16:9 yang mencolok dan bersih untuk video berjudul "${title}". Warna kontras, satu fokus visual yang jelas, pencahayaan dramatis, boleh 2-4 kata teks besar berbahasa Indonesia yang mudah dibaca. Tanpa logo, tanpa watermark.`,
        },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`AI thumbnail gagal [${res.status}]: ${await res.text()}`);
    return null;
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
  };
  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
  const b64 = url.split(",")[1];
  if (!b64) return null;
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

/** Kembalikan null jika sukses, atau pesan singkat jika gagal. */
export async function applyAiThumbnail(videoId: string, title: string, channelId: string | null) {
  try {
    const image = await generateThumbnail(title);
    if (!image) return "Thumbnail AI gagal dibuat.";
    const { getValidAccessToken } = await import("./youtube.server");
    const token = await getValidAccessToken(channelId);
    const res = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
        body: new Blob([image as BlobPart], { type: "image/png" }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(`Set thumbnail gagal [${res.status}]: ${body}`);
      return res.status === 403
        ? "Thumbnail AI tidak terpasang: channel perlu verifikasi nomor HP di YouTube agar bisa memakai thumbnail kustom."
        : "Thumbnail AI tidak terpasang.";
    }
    return null;
  } catch (err) {
    console.error("AI thumbnail error:", err);
    return "Thumbnail AI tidak terpasang.";
  }
}
