/** Ukuran potongan upload: kelipatan 256 KB sesuai aturan resumable YouTube. */
export const CHUNK_SIZE = 8 * 1024 * 1024;

/** Ambil jumlah byte yang sudah diterima dari header `Range: bytes=0-N`. */
export function parseUploadedOffset(range: string | null): number {
  const m = /bytes=0-(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

/** Rentang byte (inklusif) potongan berikutnya. */
export function nextChunkRange(offset: number, total: number, chunk = CHUNK_SIZE) {
  const end = Math.min(offset + chunk, total) - 1;
  return { start: offset, end };
}
