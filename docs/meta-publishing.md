# Veloxa: koneksi pelanggan dan publikasi Instagram/Facebook

## Model produk

Veloxa memakai satu aplikasi Meta yang dikelola operator Veloxa. Pelanggan tidak membuat akun Developer, App ID, App Secret, atau menyalin access token. Pelanggan masuk ke Veloxa, menyiapkan brand workspace, memberi izin melalui halaman resmi Facebook, memilih Page, lalu meninjau dan menerbitkan kontennya.

Jalur yang diimplementasikan adalah **Instagram API with Facebook Login**. Instagram harus berupa akun Business/Creator yang ditautkan ke Facebook Page; pengguna yang memberi izin harus memiliki tugas/akses pembuatan konten pada Page tersebut. Posting profil Facebook pribadi tidak didukung. Satu pasangan Facebook Page/Instagram aktif dapat dipilih per workspace. Beberapa Page yang dikelola pelanggan dapat muncul pada pemilihan OAuth, tetapi tidak digabung ke workspace lain.

Implementasi mengadaptasi pola pada `elhusna2025/cendekiaNew`, khususnya `functions/src/instagram-publishing.ts`, `facebook-photo-upload.ts`, dan `docs/social-content-agent.md`: token backend, JPEG final, polling Instagram, dan penahanan hasil kirim yang belum pasti. Pembatasan Page Cendekia tidak disalin. Kredensial dan koneksi produksi Cendekia tidak diekspor atau disalin ke Veloxa.

## Dukungan rilis ini

- Login email/password atau Google melalui Firebase, tanpa sesi sukses lokal saat autentikasi gagal.
- OAuth Meta dengan state sekali pakai, masa berlaku 10 menit, verifikasi token terhadap App ID, pemeriksaan izin, pagination Page, dan pemilihan Page per workspace.
- Token Page terenkripsi AES-256-GCM dengan identitas workspace sebagai authenticated data. Browser hanya menerima nama/ID publik dan status koneksi.
- Caption dan gambar post tunggal JPEG 1080 × 1350. Jika kunci OpenAI tidak tersedia atau layanan AI gagal, UI menyebutkan penggunaan template lokal.
- Foto JPEG/PNG/WebP maksimal 8 MB diunggah melalui server; binary disimpan pada Storage, bukan dimasukkan ke JSON snapshot.
- Facebook mengunggah JPEG binary ke Page Photos API; Instagram membuat image container, menunggu `FINISHED`, lalu meminta `media_publish`. ID dan permalink berasal dari respons provider.
- Receipt per kanal, quota bulanan server, penahanan pengiriman bersamaan, retry hanya kanal yang gagal definitif, dan blokir retry untuk hasil yang belum pasti.
- Akun tujuan direkam pada draf. Mengganti pilihan Page sesudah pembuatan draf tidak dapat mengalihkan publikasi draf lama ke akun lain.

Pembayaran menunggu integrasi Duitku. Endpoint pembayaran lama dan aktivasi paket dari browser dinonaktifkan. Posting otomatis, carousel, Reels, TikTok, YouTube, dan eksekusi iklan belum diaktifkan dalam alur produksi ini. Membuka profil sosial atau mengetik username tidak lagi mengaktifkan koneksi.

## Konfigurasi operator

Nama variabel tersedia di `.env.example`. Nama `META_INSTAGRAM_APP_ID`, `META_INSTAGRAM_APP_SECRET`, `META_INSTAGRAM_REDIRECT_URI`, dan `META_INSTAGRAM_API_VERSION` dari Cendekia juga dikenali sebagai alias, tetapi callback Veloxa harus menggunakan URL Veloxa, bukan callback Cendekia.

1. Sediakan backend **Next.js Node 22** pada domain HTTPS. Gunakan Firebase App Hosting atau hosting yang mendukung Next API routes. Firebase Hosting statis yang hanya menyajikan `out` tidak menjalankan endpoint ini. CI tidak lagi menghapus API routes untuk memaksa static export.
   Pada Firebase Console → App Hosting, hubungkan repo `elhusna2025/veloxa-ai`, pilih branch `main` dan root directory `/`, lalu gunakan build Next.js otomatis. File `.npmrc` menyamakan pengaturan instalasi npm dengan lockfile yang telah diuji; `npm start` memakai `PORT` dari hosting, dengan fallback lokal 3035. URL backend App Hosting ditampilkan sesudah rollout berhasil; alamat Firebase Hosting lama tidak otomatis berpindah ke backend tersebut.
2. Berikan identitas backend akses ke Firebase Auth (verifikasi sesi/revocation), database Firestore target, dan Storage bucket target melalui Application Default Credentials. Jangan memakai project Cendekia sebagai database pelanggan Veloxa.
   Aktifkan provider login email/password dan Google yang dipakai, serta authorized domains Firebase Auth untuk domain Veloxa dan pengujian lokal yang diperlukan.
3. Isi `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, dan `META_TOKEN_ENCRYPTION_KEY` pada environment backend. Simpan secret dalam secret store, bukan Git atau browser. Key enkripsi harus berupa 32 byte acak yang di-base64, stabil lintas instance dan restart. Rotasi key memerlukan migrasi token atau penyambungan ulang akun.
4. Daftarkan tepat `https://DOMAIN_VELOXA/api/veloxa/meta/callback` sebagai Valid OAuth Redirect URI pada Meta App. Tambahkan domain aplikasi dan URL kebijakan privasi/penghapusan data yang benar. App Secret tidak diperlukan oleh pelanggan.
5. Izin yang diminta: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. Untuk akun yang bukan role/tester aplikasi, selesaikan persyaratan Business Verification/App Review/Advanced Access yang berlaku di Meta. Pengujian pada akun operator sendiri belum membuktikan izin untuk seluruh pelanggan umum.
6. Jika sementara memakai Meta App yang sama dengan Cendekia, gunakan App ID/Secret yang sesuai melalui binding aman dan tambahkan callback/domain Veloxa. Jangan mengubah callback Cendekia yang masih digunakan, atau menyalin token Page Cendekia ke workspace pelanggan. Untuk peluncuran produk, aplikasi Meta khusus Veloxa memberi pemisahan merek dan operasional yang lebih jelas.
7. Deploy Firestore Rules dari repo bersama backend sebelum membuka alur pelanggan. Rules menolak client write pada connection dan seluruh koleksi token/job/usage/draft server. Entitlement pelanggan dibuat sebagai free trial dan tidak dapat dinaikkan dari browser.

`META_TOKEN_ENCRYPTION_KEY` dibaca sebagai nilai backend asli untuk kriptografi lokal; ini tidak boleh berupa placeholder proxy secret. Di lingkungan cloud development gunakan binding variabel runtime yang aman. Pada deployment, gunakan secret manager. App Secret hanya digunakan untuk permintaan HTTPS ke Meta; jangan mencetaknya ke log.

## Alur uji langsung

1. Masuk dengan akun Firebase yang memiliki workspace sendiri. Untuk pengguna lama, `activeWorkspaceId` yang tersimpan tetap dipakai; ID UID baru tidak dipotong menjadi 16 karakter.
2. Buka koneksi Instagram/Facebook dan lanjutkan ke login resmi Meta.
3. Berikan akses ke Page uji yang memang Anda kelola. Setelah kembali ke Veloxa, pilih Page tersebut. Jika Page memiliki Instagram profesional yang terkait, kedua koneksi disimpan sebagai pasangan.
4. Unggah foto bisnis bila diperlukan. Di Studio, pilih post tunggal, tulis brief, dan buat draf. Periksa caption serta JPEG final.
5. Tekan Terbitkan dan konfirmasi nama workspace/kanal tujuan. Hanya receipt yang dikonfirmasi provider mendapat status published. Buka permalink dan cocokkan posting pada Facebook/Instagram secara langsung.
6. Coba kembali draf yang sama: kanal yang sudah berhasil tidak dikirim ulang dan kuota tidak dipotong dua kali.

Jika satu kanal gagal, status menjadi `partially_published`; retry hanya mencoba kanal yang gagal. Jika provider timeout atau worker kehilangan receipt sesudah pengiriman, status ditahan (`needs_attention` atau job `processing`). Jangan membuat pengiriman ulang sebelum memeriksa akun Meta. Versi ini belum memiliki UI rekonsiliasi manual untuk membuka kembali job dengan hasil tidak pasti; operator perlu menyelidiki record dan posting provider terlebih dahulu.

Mencabut izin melalui Meta dapat membatalkan token sebelum waktu expiry yang tercatat. Error izin/token pada saat posting akan meminta penyambungan ulang; expiry bukan jaminan token selalu bisa dipakai sampai tanggal tersebut.

## Batas pembuktian dan pengujian

`npm test` menjalankan tes regresi, kontrak HTTP Meta dengan respons tiruan, enkripsi, dan alur service create → JPEG → publish dengan adapter Firebase transaksional dalam memori. Tes alur juga memeriksa kegagalan sebagian, refund kuota untuk gagal definitif, penahanan hasil tidak pasti, kehilangan write receipt, dan dua permintaan bersamaan.

`npm run functions:test` mengompilasi backend dan menjalankan kebijakan akses tenant. `functions/package.json` menunjuk entrypoint yang benar pada `lib/functions/src/index.js`.

Dengan server lokal berjalan, `npm run test:browser` membuka Chromium desktop/mobile. Suite ini memakai Next server sungguhan untuk halaman dan endpoint anonim, serta respons penolakan Firebase tiruan untuk memastikan login/registrasi/reset gagal secara benar. Screenshot/hasil disimpan pada `/tmp/veloxa-browser-e2e` atau `VELOXA_E2E_ARTIFACT_DIR`. Tentukan `PLAYWRIGHT_CHROMIUM_EXECUTABLE` jika Chromium tidak berada pada lokasi standar.

Pengujian tiruan tidak membuktikan izin aplikasi Meta, IAM Firebase, deployed Rules, atau publikasi ke akun nyata. Uji langsung pada langkah di atas tetap diperlukan setelah konfigurasi operator dan deployment tersedia. Emulator Firebase belum berhasil dijalankan pada sesi pengembangan ini karena unduhan emulator ke `storage.googleapis.com` diblokir kebijakan jaringan runtime.

## Data lama dan operasional

- Profil/workspace baru dibuat dengan batch atomik. Profil lama yang menunjuk workspace yang tidak tersedia/di luar izin tidak otomatis ditimpa; perlu pemeriksaan operator.
- Role admin dalam dokumen profil lama tidak menjadi sumber otorisasi. Backend/Rules memakai custom claim admin atau bootstrap email pemilik yang telah diverifikasi Firebase.
- Snapshot besar ditolak utuh dan tetap pending, bukan dipotong menjadi JSON rusak. Data JSON yang sudah terpotong pada versi lama memerlukan pemulihan tersendiri.
- State OAuth yang kedaluwarsa dan otorisasi Page yang sudah tidak dipakai perlu kebijakan retensi/TTL pada deployment. Pemutusan koneksi menghapus kredensial Meta untuk workspace tersebut; ini tidak menghapus posting yang sudah terbit di platform sosial.
- Caption/gambar yang dikirim kepada Meta ditujukan untuk publikasi. URL Firebase download-token adalah URL yang bisa diakses pemegang tautan; jangan gunakan media publikasi untuk menyimpan data pribadi sensitif.

Rujukan provider: dokumentasi Meta untuk [Instagram dengan Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/), [Page posts](https://developers.facebook.com/docs/pages-api/posts/), dan [OAuth login flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/). Versi Graph API dapat dikonfigurasi; default v26.0 mengikuti implementasi referensi Cendekia yang diperiksa, bukan hasil uji live pada sesi ini.
