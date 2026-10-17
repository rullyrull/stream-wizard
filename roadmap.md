# Task roadmap

## Perbaikan otomatisasi 17 Oktober
- [x] Pulihkan pengaturan utama yang hilang dan cegah proses penilaian berhenti diam-diam.
- [x] Nilai video baru pada setiap pemindaian, bukan hanya satu menit tertentu (perubahan perlu dipublish).
- [ ] Verifikasi antrean dan posting otomatis setelah penilaian berhasil — terblokir kredit AI habis (402); uji nyata menemukan 26 video Drive tetapi belum ada hasil penilaian.

## Done this session
- [x] Hapus kartu "Kredensial Google OAuth" dari halaman utama (Client ID & secret sekarang lewat secret proyek saja)
- [x] Hapus panel "Otomatis per channel" dari halaman utama (duplikat — switch aktif/jeda sudah ada di tiap baris Jadwal upload)
- [x] Tombol "Login YouTube" & "Hubungkan Google Drive": sekarang membuka tab baru (tautan target="_top" sebelumnya diblokir frame editor sehingga klik tidak melakukan apa-apa)
- [x] Hapus fitur "Tanggal mulai" dari halaman utama (kolom, state, dan pengiriman startDate)
- [x] Default jumlah video yang ditambahkan = 1000 (input, batas atas, dan clamp di sisi server)
- [x] Hapus data channel contoh dari tabel uploads (kembali 0 baris)
- [x] "Riwayat upload per channel": samakan gaya paginasi dengan Jadwal upload (10 channel per halaman, 10 video per halaman saat channel dibuka)
- [x] Paginate "Jadwal upload" queue to 10 channel groups per page
- [x] Make like / view / comment counts update near-realtime: getPerformance now refreshes video_stats from YouTube (throttled 2 min), panel auto-refetches every 30s, plus a "Segarkan statistik" button for on-demand refresh

## Open
- [x] Fitur jangkauan: cek video terkunci private, judul/deskripsi/tag AI, thumbnail AI, batas 3 video/hari per channel, jam tayang bawaan 07:00,12:00,19:00
- [ ] Login YouTube & Google Drive masih ditolak Google "Error 400: redirect_uri_mismatch" — kredensial Google OAuth (GOOGLE_OAUTH_CLIENT_ID/SECRET) sudah diisi user (2026-10-10); tersisa: user mendaftarkan https://project--6cecd1ec-47c4-44e8-86e5-2afb015e5570-dev.lovable.app/api/public/youtube/callback di Authorized redirect URIs Google Cloud Console (blocked: akses Google Cloud Console hanya user yang punya)

- [x] Mode manual: tombol "Posting" per video di daftar folder; jadwal/antrean & scan otomatis dimatikan
- [x] Analisis AI otomatis per channel tiap jam: laporan tren + panduan judul/deskripsi diterapkan langsung ke posting berikutnya, jam tayang terbaik ke autopilot; panel hasil (hanya baca) di halaman channel

- [x] Saklar mode otomatis global (ON: sistem jalan sendiri, OFF: manual) di halaman utama
- [x] Antrean per hari: 1 video per slot, tidak menumpuk; hari berikutnya pakai jam hasil analisis
- [x] Bagian "Potensi viral (penilaian AI)" bisa diminimize (dilipat)
- [x] Potensi viral (penilaian AI) otomatis saat ada video baru di folder Drive
- [x] Gabungkan "Riwayat upload" dari YouTube dan dari sistem jadi satu daftar

- [x] Riwayat permanen di database, audit 24 jam (<100 view dihapus), cron audit aktif
- [x] Ubah tampilan & tema jadi lebih elegan dan menarik
