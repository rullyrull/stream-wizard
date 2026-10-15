# Memperbaiki Mode Otomatis (jadwal kosong)

## Penyebab (sudah dicek di database)
- Tidak ada pemicu terjadwal yang aktif: penjadwal otomatis yang memanggil autopilot tidak ikut tersalin saat remix, jadi autopilot tidak pernah berjalan.
- Pengaturan autopilot per channel kosong (belum ada channel yang diaktifkan dengan folder Drive), dan tabel antrean upload kosong.
- Baris pengaturan umum aplikasi juga belum ada.

## Yang akan dikerjakan
1. Buat baris pengaturan umum default (mode otomatis ON).
2. Pasang ulang penjadwal otomatis yang memanggil endpoint autopilot setiap 15 menit (memindai Drive, mengisi jadwal hari ini, mengunggah video yang sudah jatuh tempo). 96 kali/hari — cukup agar upload tepat waktu di slot jam; lebih jarang berarti upload bisa telat hingga selama interval tersebut.
3. Di halaman, tampilkan peringatan kecil pada channel yang mode otomatisnya belum diaktifkan / belum punya folder Drive, agar jelas kenapa jadwalnya kosong.

## Yang perlu Anda lakukan
- Aktifkan Mode otomatis dan isi link folder Drive untuk tiap channel.
- Publish aplikasi, karena penjadwal memanggil alamat aplikasi yang sudah dipublish.

## Detail teknis
- `pg_cron` + `pg_net` POST ke `/api/public/cron/autopilot` dengan header `apikey` (publishable key), sesuai pengecekan di handler.
- Insert `app_settings (id='default')`.
- UI hint di `src/routes/index.tsx` berdasarkan `channel_autopilot.enabled` dan `folder_url`.
