# Sonara – pemutar musik PWA dari YT Music

Web pemutar musik yang bisa dipasang sebagai aplikasi (PWA), dengan pencarian lagu dari YT Music, antrean otomatis, favorit, playlist, dan cache offline. Tanpa dependency npm, tanpa build step.

## Fitur

- Cari lagu dari YT Music, lengkap dengan saran pencarian.
- Pemutar penuh dan mini player, antrean, acak, ulangi, autoplay lagu serupa.
- Tombol di layar kunci dan headset (Media Session).
- Favorit, playlist, riwayat, dan lagu tersimpan, semuanya di perangkat.
- Bisa dipasang ke layar utama (Android, desktop Chrome/Edge, iOS lewat "Tambah ke Layar Utama").
- Mode offline: aplikasi tetap terbuka, hasil pencarian sebelumnya dibuka dari cache, dan lagu yang pernah muncul bisa dicari dari penyimpanan perangkat.

## Cara deploy

1. Ekstrak ZIP, lalu buat repositori baru di GitHub dan upload semua isinya (atau `git init && git add . && git commit -m "init" && git push`).
2. Buka [vercel.com/new](https://vercel.com/new), pilih repositori tadi, lalu klik **Deploy**. Tidak perlu mengubah pengaturan apa pun: Framework Preset "Other", Output Directory sudah diatur di `vercel.json`.
3. Buka URL yang diberikan Vercel. Di Chrome Android/desktop akan muncul tombol **Pasang aplikasi**. Di iPhone: Safari, Bagikan, **Tambah ke Layar Utama**.

PWA butuh HTTPS. Vercel sudah menyediakannya.

## Menjalankan di komputer sendiri

```bash
npm i -g vercel
vercel dev
node test/parse.test.js   # tes parser API (tanpa internet)
```

## Struktur

```
api/            fungsi serverless Vercel (proxy ke YT Music)
  search.js       GET /api/search?q=...
  suggest.js      GET /api/suggest?q=...
  next.js         GET /api/next?v=VIDEO_ID   (lagu serupa untuk autoplay)
  _yt.js          helper + parser (tidak menjadi route)
public/         situs statis
  index.html, styles.css, app.js
  sw.js           service worker (cache offline)
  manifest.webmanifest, icons/
vercel.json     konfigurasi Vercel
test/           tes parser
```

## Cara kerja cache offline

| Yang di-cache | Strategi | Offline |
| --- | --- | --- |
| Halaman, CSS, JS, ikon | cache dulu, diperbarui di latar belakang | aplikasi terbuka |
| Hasil `/api/search`, `/api/suggest`, `/api/next` | jaringan dulu, cache sebagai cadangan | pencarian yang pernah dilakukan tetap terbuka |
| Cover lagu | cache dulu (maks. 600) | cover tampil |
| Font | cache dulu | tampilan tetap konsisten |
| Daftar lagu yang pernah muncul (localStorage, maks. 600) | dicari di perangkat | pencarian offline untuk lagu yang sudah pernah dilihat |

## Batasan yang perlu diketahui

- **Audio tidak bisa disimpan offline.** Lagu diputar lewat pemutar resmi YouTube (IFrame API), yang butuh internet dan tidak mengizinkan audionya di-cache. Karena itu "Tersimpan" menyimpan info lagu dan cover, bukan file audio. Menyimpan atau mengunduh audio YouTube melanggar ketentuan layanannya, jadi sengaja tidak dibuat.
- **Latar belakang/layar kunci:** di Android Chrome biasanya terus berbunyi. Di iOS, audio bisa berhenti saat layar terkunci atau aplikasi ditutup, ini batasan dari YouTube/Safari.
- **Lagu tertentu tidak bisa diputar** bila pemilik menonaktifkan embed. Aplikasi otomatis lanjut ke lagu berikutnya.
- **API YT Music tidak resmi.** `api/_yt.js` memakai endpoint internal yang bisa berubah tanpa pemberitahuan. Jika pencarian tiba-tiba kosong atau gagal, cek `YTM_CLIENT_VERSION` (bisa diatur lewat Environment Variables di Vercel, contoh `1.20260101.01.00`) atau sesuaikan parser di `api/_yt.js`. Sesekali YouTube juga memblokir IP datacenter; coba deploy ulang atau ganti region di pengaturan Vercel.
- Proyek ini untuk penggunaan pribadi dan belajar. Pastikan penggunaanmu sesuai ketentuan layanan YouTube.

## Kustomisasi cepat

- Nama aplikasi: `index.html` (judul dan `.brand`), `manifest.webmanifest`.
- Warna: variabel di bagian atas `public/styles.css`.
- Ikon: ganti file di `public/icons/` (192, 512, dan versi maskable 512).
- Setelah mengubah file di `public/`, naikkan `VERSION` di `public/sw.js` agar pengguna mendapat versi baru.
