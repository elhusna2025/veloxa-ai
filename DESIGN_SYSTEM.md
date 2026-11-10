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
- Kategori aset menjelaskan isi. Peran referensi pada sebuah konten menjelaskan penggunaan; pengguna tetap dapat memeriksanya, terutama logo dan screenshot asli.
- Tampilkan swatch, kode warna, serta pratinjau yang membantu pengguna memahami hasil. Jangan hanya menampilkan kumpulan kode HEX.

## Navigasi dan konteks

Urutan workspace: **Beranda → Profil & aset → Content Studio → Jadwal konten → Meta Ads**. Akun sosial menjadi pengaturan koneksi terpisah. Navigasi ponsel mengikuti urutan makna yang sama; label boleh dipendekkan.

Bisnis aktif ditampilkan dengan nama, identitas singkat, dan akun yang terkait. Pergantian bisnis tidak membuang perubahan yang belum disimpan atau menerapkan hasil AI ke bisnis lain.

## Pratinjau dan status proses

- Post tunggal menggunakan pratinjau besar dengan rasio utuh. Carousel dapat digeser dan memiliki panah, nomor slide, serta thumbnail. Reels memiliki video/audio controls.
- Sediakan tindakan buka/unduh; jangan menampilkan thumbnail kecil sebagai satu-satunya cara meninjau hasil.
- Operasi jaringan memiliki indikator tahap dan tombol sibuk/disabled. Kegagalan menyebut tahap, status hasil yang diketahui, dan langkah berikutnya.
- Jangan menampilkan persen atau waktu selesai palsu. Jangan mengklaim berhasil ketika hanya permintaan yang terkirim.
- Hasil jaringan yang belum pasti tidak boleh memicu generasi atau kiriman ganda. Tawarkan pemeriksaan hasil proses yang sama.
- Untuk publikasi otomatis, tampilkan akun, bahan, format, hari/jam WIB, dan ringkasan sebelum aktivasi. Simpan aturan tidak mengaktifkannya. Status Sedang menjeda berbeda dari sudah dijeda.

## Aksesibilitas dan responsivitas

Gunakan elemen semantik, label yang jelas, focus ring terlihat, dan navigasi keyboard. Warna bukan satu-satunya penanda status. Tombol ikon memiliki nama aksesibel. Status loading/error/sukses diumumkan seperlunya; jangan membuat penghitung waktu terus mengganggu pembaca layar.

Layar harus berfungsi pada lebar 390 px dan desktop tanpa overflow halaman. Kartu menyusun ulang, teks membungkus, dialog dapat discroll, dan menu tidak keluar layar. Jangan menyembunyikan informasi penting semata-mata untuk membuat layar muat.

## Verifikasi perubahan UI

1. Gunakan kembali komponen yang ada dan cek kesesuaiannya dengan panduan ini.
2. Periksa kondisi kosong, loading, berhasil, gagal, disabled, pilihan aktif, dan perubahan belum disimpan yang relevan.
3. Uji keyboard serta tampilan desktop dan 390 px melalui browser nyata.
4. Simpan screenshot bukti dan laporkan batas verifikasi secara jujur.
5. Saat pola baru disetujui, perbarui panduan dan komponen bersama agar layar berikutnya mengikuti pola yang sama.
