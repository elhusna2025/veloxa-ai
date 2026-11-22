# Koneksi kanal YouTube di Veloxa

Implementasi ini hanya memberi izin baca metadata kanal milik akun Google, menampilkan pilihan kanal, dan menyimpan satu kanal yang dikonfirmasi pemilik untuk setiap bisnis. Tidak ada upload, publikasi, penjadwalan, pilihan target Studio, analisis profil merek, atau perubahan terhadap koneksi Meta. Pengujian lokal menggunakan data tiruan; tidak ada kanal yang dinyatakan terhubung secara langsung.

## Persiapan Google Cloud Console

1. Aktifkan **YouTube Data API v3** di proyek Google Cloud yang akan dipakai untuk OAuth. Buat OAuth Client ID bertipe **Web application**. [Panduan otorisasi YouTube](https://developers.google.com/youtube/data/guides/authentication)
2. Lengkapi Google Auth Platform: identitas aplikasi dan kontak, audiens, domain yang berwenang, tautan kebijakan privasi, dan pengaturan akses data. Daftarkan hanya scope `https://www.googleapis.com/auth/youtube.readonly`. Jika audiens eksternal masih dalam status **Testing**, masukkan akun Google penguji yang memiliki atau mengelola kanal yang akan diuji. Dengan scope YouTube, refresh token untuk aplikasi eksternal dalam status Testing berlaku tujuh hari. [Masa berlaku token Google OAuth](https://developers.google.com/identity/protocols/oauth2#expiration)
3. Tambahkan **Authorized redirect URI** berupa origin HTTPS aplikasi Veloxa, diikuti `/api/veloxa/youtube/callback` tanpa garis miring akhir. Nilainya harus cocok persis dengan `YOUTUBE_REDIRECT_URI`. Jangan tambahkan query, fragmen, atau kredensial. Gunakan origin HTTPS yang sama untuk memulai OAuth agar browser mengirim cookie host-only pada callback. Veloxa mewajibkan HTTPS untuk alur ini. [OAuth untuk aplikasi server web](https://developers.google.com/identity/protocols/oauth2/web-server)
4. Sebelum akses publik, tuntaskan verifikasi merek, domain, dan scope sensitif sesuai persyaratan Google untuk audiens aplikasi. Publikasi nantinya memerlukan persetujuan tambahan secara inkremental dan pemenuhan persyaratan Google yang berlaku. [Verifikasi scope sensitif](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

## Variabel lingkungan server

| Variabel | Persyaratan |
| --- | --- |
| `YOUTUBE_OAUTH_ENABLED` | Harus bernilai `true` untuk mengizinkan consent baru. |
| `YOUTUBE_OAUTH_ALLOWED_WORKSPACE_IDS` | ID workspace Veloxa yang diizinkan, dipisahkan koma. Daftar kosong, entri tidak valid, atau wildcard menonaktifkan consent. |
| `YOUTUBE_CLIENT_ID` | Client ID aplikasi web dari Google Auth Platform. |
| `YOUTUBE_CLIENT_SECRET` | Secret OAuth aplikasi web. |
| `YOUTUBE_REDIRECT_URI` | URL callback HTTPS terdaftar dengan path persis sebagaimana dijelaskan di atas. |
| `YOUTUBE_TOKEN_ENCRYPTION_KEY` | Kunci acak 32 byte dalam format Base64 standar kanonis dengan padding, bukan Base64URL. |

Simpan variabel di pengelola konfigurasi server. Jangan menambahkan awalan `NEXT_PUBLIC_`, menyalin nilai ke repositori, atau mencatat kode OAuth, parameter callback, isi respons provider, maupun token dalam log aplikasi atau akses. Perubahan konfigurasi membatalkan consent tertunda; koneksi lama yang tidak lagi cocok ditampilkan sebagai `reconnect_required` dan tidak ditimpa sampai pemilik mengonfirmasi grant baru.

Untuk uji terbatas, masukkan hanya ID workspace yang disetujui. Jika workspace tidak tercantum, daftar menampilkan `configured:false` tanpa opsi kanal tertunda, permintaan mulai dan simpan menerima `503 youtube_not_configured`, dan callback gagal sebelum pertukaran token. Pemilik tetap dapat memutuskan koneksi tersimpan secara lokal.

## Kontrak backend untuk integrasi UI

Semua path berada di `/api/veloxa/youtube`. `workspaceId` dan `businessId` wajib diisi pada setiap operasi aplikasi; gunakan `primary` atau ID bisnis `b_UUID` yang benar-benar ada. Endpoint selain callback menggunakan sesi Firebase Veloxa melalui header `Authorization: Bearer …`.

| Endpoint | Perilaku |
| --- | --- |
| `POST /start` | Pemilik workspace mengirim JSON `{workspaceId,businessId,startRevision}` dengan versi dari GET terakhir. Server membandingkan versi secara transaksional; permintaan lama mendapat 409 tanpa mengubah consent yang lebih baru. Respons `{ok:true,url}` memulai consent Google di browser yang sama. |
| `GET /callback` | Memeriksa cookie, state sekali pakai, PKCE, pemilik, serta generasi bisnis. Mengalihkan dengan 303 ke origin terkonfigurasi saja: `/?youtube=authorized` jika pilihan kanal tersedia, atau `/?youtube=failed` bila tidak. Tanpa origin callback yang valid, respons gagal tanpa pengalihan. `authorized` belum berarti kanal tersimpan. |
| `GET /accounts?workspaceId=…&businessId=…` | Akses workspace yang sah menerima `{ok:true,configured,startRevision,connection,channels,authorizationId?}`. `startRevision` adalah bilangan bulat aman nonnegatif untuk memulai consent dari versi bisnis yang telah diperiksa; tersedia juga saat konfigurasi belum aktif. Koneksi berisi `channelId`, `title`, `handle`, `url`, `status`, `connectedAt` (milidetik Unix), dan `revision` untuk konfirmasi pemutusan. Nilainya `null` jika belum ada koneksi. `handle` kosong jika Google tidak mengembalikan handle. `connected` menandakan pilihan tersimpan yang cocok dengan pemilik workspace dan konfigurasi saat ini. Endpoint ini membaca status lokal. |
| `POST /connection` | Pemilik mengirim JSON `{workspaceId,businessId,authorizationId,channelId}`. Hanya kanal dalam grant tertunda yang dapat dipilih dan satu kanal tidak dapat digunakan oleh dua bisnis dalam workspace yang sama. Respons `{ok:true}` menandakan penyimpanan berhasil. |
| `DELETE /connection` | Pemilik mengirim JSON `{workspaceId,businessId,channelId,revision}` dengan kanal dan revisi dari daftar terakhir. Koneksi yang cocok dihapus bersama izin tertunda untuk bisnis tersebut dan responsnya `{ok:true}`. Jika koneksi berubah, server mengembalikan 409 dan pemilik perlu memuat ulang daftar. Jika sudah terputus, pengulangan mengembalikan `{ok:true}` dan mempertahankan izin tertunda baru. Grant Google yang dapat dipakai integrasi lain tetap berlaku. |

State dan pilihan tertunda masing-masing berlaku 10 menit. Memulai consent baru atau menghapus koneksi yang masih tersimpan membatalkan tindakan tertunda yang lebih lama di bisnis yang sama. Koneksi tersimpan diganti saat pemilik berhasil mengonfirmasi kanal baru. Server mengenkripsi access token dan refresh token bersama dengan AES-256-GCM dan mengikatnya ke workspace, bisnis, dan grant.

Cookie YouTube memiliki pengikat acak yang terpisah dari state pada URL dan nama khusus per percobaan. Server memeriksa digest pengikat tersebut secara transaksional sebelum mengonsumsi state. Callback lama hanya menghapus cookie percobaannya sendiri. Grant yang memuat scope tambahan di luar izin baca ditolak.

UI memverifikasi pasangan daftar kanal dan `authorizationId`, mengunci perubahan saat hasil permintaan belum pasti, dan memuat ulang status sebelum percobaan berikutnya. Konfirmasi pemutusan mengikat kanal serta revisi yang ditinjau; perubahan koneksi mewajibkan konfirmasi baru.

State dan otorisasi tertunda menyimpan `deleteAt` sebagai tanggal Firestore, dengan nilai yang sama seperti angka `expiresAt` untuk pemeriksaan aplikasi. Sebelum mengaktifkan koneksi pelanggan, aktifkan TTL pada field `deleteAt` di collection group `_youtube_oauth_states` dan `private_youtube_authorizations`, lalu verifikasi status kebijakannya. Koneksi yang sudah disimpan tidak memiliki field TTL. TTL menghapus record secara asinkron; jangan menyatakan penghapusan fisik selesai tepat setelah 10 menit. [Retensi TTL Firestore](https://firebase.google.com/docs/firestore/ttl)

Sebelum pengujian dengan kanal nyata, verifikasi patch dengan `npm run typecheck`, `npm test`, dan `npm run build`, serta tinjau hasil review keamanan dan QA. Pengujian kanal nyata berhenti setelah pemilihan atau pemutusan lokal; jangan mengunggah atau menerbitkan konten.
