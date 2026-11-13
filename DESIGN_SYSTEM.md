# Veloxa Design System

Status: acuan desain proyek, disepakati 11 November 2026 (Asia/Jakarta).

Panduan ini berlaku untuk antarmuka publik dan workspace Veloxa. Tujuannya membuat layar mudah dipahami, nyaman dibaca, konsisten, dan tetap menarik. Gunakan komponen bersama; jangan membuat variasi kontrol baru untuk kebutuhan yang sama. Perubahan arah desain mengikuti permintaan pengguna, lalu panduan ini diperbarui bersama implementasinya.

## Prinsip produk

- Tampilkan tindakan utama dan konteks bisnis aktif dengan jelas.
- Jelaskan manfaat dalam satu kalimat pendek. Hindari paragraf bantuan yang berulang dan label teknis yang tidak diperlukan pengguna.
- Ukuran teks harus nyaman dibaca. Prioritaskan ruang, hierarki, dan visual, bukan mengecilkan tulisan agar semua muat.
- Selalu bedakan usulan AI, perubahan formulir yang belum disimpan, data tersimpan, draf, dan publikasi yang sudah berhasil.
- Profil, aset, produk, DNA, akun tujuan, jadwal, dan iklan mengikuti bisnis aktif. Jangan mencampur identitas dua bisnis.
- Perubahan tampilan tidak boleh mengubah makna izin, tujuan publikasi, atau status tersimpan.

## Fondasi visual

| Elemen | Aturan |
| --- | --- |
| Latar aplikasi | `#F6F7F9`; panel putih |
| Teks utama | Neutral 900 / `#171717` |
| Teks pendamping | Neutral 500–600; tetap terbaca |
| Aksen Veloxa | `#A92E5D`; pilihan aktif `#BD416E` dengan latar lembut `#FAF2F5` |
| Tombol utama | Gelap/neutral 950 atau aksen sesuai komponen bersama; satu tindakan dominan per bagian |
| Border | Neutral 200 / `#E5E5E5`; tipis, bukan bayangan berat |
| Radius | Kontrol/tombol 8 px; panel/dialog 12 px; badge kecil 4–6 px |
| Spasi | Gunakan kelipatan 4/8 px; jarak antarkelompok 20–28 px |
| Teks isi/input | 16 px dengan jarak baris nyaman |
| Label/bantuan | 14 px; 12 px hanya untuk metadata/badge singkat |
| Judul halaman | 28–32 px; judul bagian 20–24 px |
| Tinggi kontrol | Minimal 44 px; area klik nyaman pada ponsel |

Jangan memakai radius pill pada seluruh input, tombol, atau kartu. Pill hanya untuk badge singkat bila berguna. Hindari bayangan gelap besar, dekorasi berlebihan, dan satu gaya abu-abu seragam tanpa hierarki.

Warna DNA bisnis merupakan arahan untuk **konten bisnis**. Warna logo Berez/Cendekia tidak otomatis mengganti tema aplikasi Veloxa.

## Landing page publik

- Gunakan plum gelap, krem hangat, dan aksen rose. Gunakan warna rose untuk tindakan utama di permukaan gelap.
- Pakai font sans-serif bawaan Veloxa untuk seluruh teks landing page. Bedakan judul utama, judul bagian, harga, dan teks isi lewat ukuran, bobot, dan jarak baris. Gunakan angka berlebar tetap pada harga dan hasil kalkulator.
- Buka dengan manfaat produk dan visual kampanye. Tampilkan demo Cara kerja di bagian tersendiri setelah daftar kanal. Tunjukkan pemberian izin akun, pembuatan gambar dan caption, pilihan cara menerbitkan, dan hasil di akun tujuan. Pengunjung bisa memilih langkah serta memutar atau menjeda demo.
- Bandingkan cara kerja yang konkret. Kalkulator biaya memakai angka ilustratif yang bisa diedit, harga paket resmi dari konfigurasi aplikasi, dan hasil yang berubah mengikuti masukan.
- Pada layar di bawah 768 px, tampilkan alur sambutan enam slide untuk pengunjung yang belum masuk. Gunakan satu tujuan dan satu ilustrasi per slide. Jelaskan manfaat Veloxa, koneksi akun, pembuatan draf AI, pilihan publikasi, dan hasil. Akhiri dengan tombol mulai uji coba.
- Tampilkan foto kampanye editorial selebar layar sambutan dan letakkan judul serta penjelasan pada bidang krem yang terpisah. Pakai palet plum, rose, dan tembaga untuk menyatukan keenam adegan. Beri label pada simulasi publikasi agar pengunjung mengenalinya sebagai contoh.
- Gunakan teks penjelasan 18–19 px pada sambutan. Pendekkan naskah supaya nyaman dibaca dan sisakan ruang untuk kontrol pada layar pendek.
- Alur sambutan bergerak otomatis setiap delapan detik dan berhenti di slide terakhir. Sediakan putar dan jeda, geser, tombol kembali dan lanjut, indikator yang bisa dipilih, serta tindakan Lewati. Hentikan putar otomatis saat pengunjung memakai kontrol navigasi, menggeser, atau masuk dengan keyboard. Mulai dalam keadaan dijeda ketika perangkat meminta pengurangan gerakan.
- Pertahankan Masuk dan pilihan bahasa di bagian atas. Gunakan target sentuh minimal 44 px, area aman perangkat, dan urutan kanan ke kiri untuk bahasa Arab.
- Gunakan naskah dan harga sesuai bahasa yang dipilih. Tata bahasa Arab dari kanan ke kiri, termasuk susunan navigasi dan perbandingan.
- Tampilkan status aktivasi paket dan kanal sesuai ketersediaan produk.

## Masuk, daftar, pemulihan akun, dan dokumen hukum

- Gunakan latar putih bersih, header publik versi terang, dan aksen plum dari alur sambutan. Tampilkan foto editorial hanya pada panel samping Masuk dan Daftar di desktop.
- Susun formulir satu kolom dengan label yang selalu terlihat, input 16 px atau lebih, dan tombol minimal 44 px. Sisakan ruang aman perangkat dan biarkan layar bergulir saat keyboard terbuka.
- Pada pendaftaran lewat email, minta konfirmasi kata sandi dan tampilkan pesan di dekat kolomnya jika berbeda. Aktifkan pendaftaran lewat email dan Google setelah Ketentuan dan Privasi dicentang. Bedakan status masuk, membuat akun, menunggu Google, dan mengirim tautan reset di tombol yang sedang dipakai.
- Tampilkan Ketentuan dan Privasi sebagai dokumen satu kolom dengan judul, tanggal, dan tautan antarhalaman. Gunakan pembatas tipis untuk memisahkan bagian.
- Pada onboarding, gunakan satu kolom dengan tiga langkah berurutan: Bisnis, Kanal, dan Paket. Tampilkan informasi wajib terlebih dahulu, lipat preferensi opsional, dan ringkas pilihan sebelum menyimpan. Gunakan tombol kembali dan lanjut yang mudah dijangkau di HP.
- Gunakan judul langkah onboarding 22 px pada HP dan 26 px pada desktop, dengan teks petunjuk 16 px.
- Terapkan bahasa pilihan pengguna ke seluruh onboarding, termasuk pilihan bidang bisnis, pesan validasi, dan status simpan. Ganti bahasa tanpa mengatur ulang isian atau langkah aktif. Tampilkan alur bahasa Arab dari kanan ke kiri.

## Pilihan, dropdown, dan input

- Untuk 2–4 pilihan yang perlu dipahami, gunakan kartu radio/segmented selector dengan judul dan satu keterangan singkat. Contoh: Tujuan konten, sumber ide, format, mode palet.
- Tujuan konten harus memakai komponen bersama di Studio dan Jadwal: AI pilihkan, Edukasi manfaat, Perkenalan produk, Promosi.
- Untuk daftar yang lebih panjang/ringkas, gunakan dropdown aplikasi bersama. Jangan menambahkan `<select>` native untuk pilihan workspace yang akan memunculkan popup bergaya sistem operasi.
- Popup dropdown berlatar putih, border tipis, radius 8 px, bayangan ringan, tanda pilihan yang jelas, dan tinggi daftar terbatas dengan scroll. Lebarnya mengikuti kontrol dan tidak melewati viewport.
- Dropdown harus mengelola fokus, label, status terpilih, klik luar, Escape, tombol panah, Enter/Space, serta Tab. Gunakan pencarian/typeahead bila daftar panjang.
- Kategori bisnis dapat memakai picker khusus yang sudah ada. Pilihan jenis aset juga dapat memakai kartu; nama foto dan kategori merupakan dua hal berbeda.
- File picker, date/time picker, dan color picker boleh memakai kontrol platform ketika itu membantu tugas pengguna. Kontrol tersebut tetap memiliki label dan bingkai yang konsisten.
- Jangan membuat pilihan palsu yang tampak tersedia ketika belum didukung. Tampilkan status dan penjelasan singkat.
- Gunakan label permanen; placeholder hanya contoh, bukan pengganti label. Tandai isian opsional dan batas yang benar-benar berlaku.
- Komponen lama diperbarui ke pola ini saat disentuh. Jangan menyatakan semua layar sudah konsisten sebelum inventaris serta pemeriksaan dilakukan.

## Formulir profil, aset, dan DNA

- Identitas bisnis, Panduan konten, DNA visual, serta Foto & referensi dipisahkan dengan tab yang jelas.
- Nama aset bebas; jenis aset memakai pilihan baku dan Lainnya dengan label khusus.
- Hasil pengenalan AI adalah **usulan**. Pengguna dapat mengonfirmasi atau mengoreksi; nama file bukan bukti jenis aset.
- Logo utama dan palet ditinjau pada DNA visual. Mode Ikuti warna logo dan Atur palet sendiri harus mudah dibedakan.
- Palet pertama dapat mengisi pratinjau formulir. Palet tersimpan atau edit manual tidak boleh ditimpa diam-diam oleh unggahan atau respons AI yang datang terlambat.
- Palet baru tersimpan melalui Simpan profil. Batal mempertahankan nilai sebelumnya.
- Tampilkan palet di awal tinjauan hasil analisis akun sosial, dengan contoh warna, kode HEX, dan sumber. Jika tidak ada usulan warna, tampilkan palet tersimpan atau petunjuk memilih logo pada DNA visual.
- Kategori aset menjelaskan isi. Peran referensi pada sebuah konten menjelaskan penggunaan; pengguna tetap dapat memeriksanya, terutama logo dan screenshot asli.
- Tampilkan swatch, kode warna, serta pratinjau yang membantu pengguna memahami hasil. Jangan hanya menampilkan kumpulan kode HEX.

## Navigasi dan konteks

Urutan workspace: **Beranda → Profil & aset → Content Studio → Jadwal konten → Meta Ads**. Akun sosial menjadi pengaturan koneksi terpisah. Navigasi ponsel mengikuti urutan makna yang sama; label boleh dipendekkan.

Bisnis aktif ditampilkan dengan nama, identitas singkat, dan akun yang terkait. Pergantian bisnis tidak membuang perubahan yang belum disimpan atau menerapkan hasil AI ke bisnis lain.

## Workspace di ponsel dan desktop

- Gunakan permukaan putih, bingkai tipis, dan latar netral hangat. Ambil plum `#682943`, rose `#F2AFC8`, dan krem `#FFF7EE` dari alur sambutan. Gunakan aksen lembut pada navigasi aktif, ikon, dan pengantar halaman. Simpan panel plum gelap untuk tindakan utama di Beranda.
- Di ponsel, gunakan judul halaman sekitar 21 px dan tampilkan pilihan bahasa di header serta navigasi utama di bawah dengan area aman perangkat. Di desktop, pertahankan sidebar dan judul sekitar 26 px. Beri fokus keyboard yang terlihat dan nama aksesibel pada tombol ikon.
- Tempatkan pemilih bisnis di atas isi. Sebelum publikasi pertama, Beranda menampilkan panduan akun sosial, Profil & aset, draf di Studio, dan tinjauan publikasi. Tandai langkah aktif dari status bisnis yang tersimpan. Setelah satu kiriman berhasil, tampilkan tindakan membuat konten dan pintasan format seperti biasa.
- Saat pemeriksaan akun selesai dan bisnis aktif belum punya akun yang siap digunakan, tampilkan tindakan koneksi di bagian atas Beranda. Jika ada akun terhubung yang belum ditautkan, arahkan ke Kelola bisnis. Tandai publikasi selesai hanya setelah ada konfirmasi berhasil pada salah satu akun tujuan.
- Profil, Studio, Jadwal, dan Meta Ads memakai pengantar ringkas, dengan formulir satu kolom pada HP. Gunakan ruang dan pengelompokan untuk membedakan tahap, tanpa memperbesar judul.
- Di Meta Ads, tampilkan status koneksi dan akun iklan yang siap digunakan. Pasangkan status terhubung dengan **Putuskan koneksi**, dan gunakan **Hubungkan kembali** saat sesi atau izin perlu diperbarui. Konfirmasi pemutusan menjelaskan cakupan workspace dan dampaknya pada kampanye aktif. Kampanye tersedia di semua paket, termasuk Free Trial. Tampilkan bahwa biaya tayang dibebankan ke akun iklan yang dipilih dan minta pengguna meninjau anggaran sebelum aktivasi.
- Satu pilihan bahasa berlaku untuk navigasi dan teks antarmuka workspace tanpa mengulang formulir. Pertahankan nama bisnis, isi pengguna, dan hasil AI dalam bahasa asalnya. Letakkan navigasi Arab dari kanan ke kiri dan pertahankan format angka, waktu WIB, dan rasio agar jelas.
- Pesan pengguna menyebut hasil yang diketahui dan langkah berikutnya. Jangan tampilkan nama database, identitas proyek infrastruktur, atau penanda sinkronisasi internal.

## Arahan visual dengan bantuan AI

- AI membaca gambar aktual yang dipilih sesuai urutan Ref dan peran pengguna; nama foto bukan satu-satunya sumber.
- Usulan menampilkan pengamatan gambar, arahan, dan keterbatasan. Teks manual tidak ditimpa sebelum pengguna menekan Gunakan arahan ini. Batal mempertahankan teks.
- Perubahan bisnis, profil, urutan/aset/peran, format, topik, produk, tujuan, atau teks membatalkan usulan lama. Jangan menerapkan respons terlambat.
- Selama analisis, tampilkan tahap nyata dan cegah permintaan/generasi ganda. Bantuan arahan tidak membuat draf atau menerbitkan konten.
- Di Studio untuk carousel, tempatkan topik dan arahan visual opsional setelah referensi. Tawarkan satu usulan AI berisi topik, arahan bersama, dan lima slide berurutan. Pengguna menerapkan usulan sebelum mengedit judul, isi, adegan, dan acuan setiap slide. Aset asli bersama tetap terlihat terpisah dari acuan per slide.
- Tipografi hasil konten mengacu pada [CONTENT_DESIGN_SYSTEM.md](CONTENT_DESIGN_SYSTEM.md), terpisah dari ukuran UI aplikasi.

## Pratinjau dan status proses

- Post tunggal menggunakan pratinjau besar dengan rasio utuh. Carousel dapat digeser dan memiliki panah, nomor slide, serta thumbnail. Reels memiliki video/audio controls.
- Sediakan tindakan buka/unduh; jangan menampilkan thumbnail kecil sebagai satu-satunya cara meninjau hasil.
- Operasi jaringan memiliki indikator tahap dan tombol sibuk/disabled. Kegagalan menyebut tahap, status hasil yang diketahui, dan langkah berikutnya.
- Jangan menampilkan persen atau waktu selesai palsu. Jangan mengklaim berhasil ketika hanya permintaan yang terkirim.
- Hasil jaringan yang belum pasti tidak boleh memicu generasi atau kiriman ganda. Tawarkan pemeriksaan hasil proses yang sama.
- Untuk publikasi otomatis, tampilkan akun, bahan, format, hari/jam WIB, dan ringkasan sebelum aktivasi. Simpan aturan tidak mengaktifkannya. Status Sedang menjeda berbeda dari sudah dijeda.
- Aktivitas otomatis membedakan konten yang akan diperbaiki, pengiriman yang akan dicoba lagi, dan hasil yang perlu diperiksa. Tampilkan waktu percobaan berikutnya dalam WIB saat sudah dijadwalkan. Tandai terbit hanya setelah kanal mengonfirmasi.

## Aksesibilitas dan responsivitas

Gunakan elemen semantik, label yang jelas, focus ring terlihat, dan navigasi keyboard. Warna bukan satu-satunya penanda status. Tombol ikon memiliki nama aksesibel. Status loading/error/sukses diumumkan seperlunya; jangan membuat penghitung waktu terus mengganggu pembaca layar.

Layar harus berfungsi pada lebar 390 px dan desktop tanpa overflow halaman. Kartu menyusun ulang, teks membungkus, dialog dapat discroll, dan menu tidak keluar layar. Jangan menyembunyikan informasi penting semata-mata untuk membuat layar muat.

## Verifikasi perubahan UI

1. Gunakan kembali komponen yang ada dan cek kesesuaiannya dengan panduan ini.
2. Periksa kondisi kosong, loading, berhasil, gagal, disabled, pilihan aktif, dan perubahan belum disimpan yang relevan.
3. Uji keyboard serta tampilan desktop dan 390 px melalui browser nyata.
4. Simpan screenshot bukti dan laporkan batas verifikasi secara jujur.
5. Saat pola baru disetujui, perbarui panduan dan komponen bersama agar layar berikutnya mengikuti pola yang sama.

## Super Admin

- Pisahkan navigasi Super Admin dari workspace pengguna. Tautan Workspace saya hanya membuka workspace milik admin. Detail pelanggan bersifat baca saja, kecuali tindakan operasional yang menyebut bisnis dan dampaknya secara eksplisit.
- Gunakan sidebar kiri bersama untuk Super Admin dan workspace pengguna. Urutan Super Admin adalah Beranda, Workspace, Operasi Otonom, Pengaturan AI & kuota, Langganan & biaya, dan Integrasi. Letakkan Workspace saya dan Keluar di bagian bawah. Di bawah 1024 px, tombol pada header membuka sidebar dari kiri. Saat ditutup, fokus kembali ke tombol menu.
- Mulai dari kesehatan layanan, jumlah terkonfirmasi, antrean yang perlu perhatian, dan slot terdekat. Bedakan slot yang belum pasti, antrean pemulihan, dan hasil yang sudah dikonfirmasi. Tampilkan periode pengukuran dan WIB.
- Gunakan kartu ringkas dan daftar yang dapat dibuka untuk hasil per akun; susun satu kolom di ponsel. Status selalu memiliki label teks. Kuota publikasi bulanan dipisahkan dari percobaan pembuatan draf harian.
- Menjeda satu aturan meminta alasan, membedakan proses yang masih berjalan, dan tidak menjadi tindakan untuk mengirim ulang konten. Simpan jejak tindakan di server.
- Pengaturan model dan kuota selalu menampilkan cakupannya, seluruh platform atau workspace tertentu. Tampilkan nilai yang diwariskan, kuota efektif, serta perubahan yang belum disimpan.
- Tinjau perubahan beserta cakupan dan alasan sebelum menyimpan. Pemulihan memakai revisi baru dan dicatat bersama waktu, pelaku, dan revisi sumber.
