# Build FFprobe untuk unggahan YouTube

Jalankan workflow **Build YouTube FFprobe** di GitHub Actions. Build Linux x64 memakai Ubuntu 22.04 dengan glibc 2.35 agar biner dapat dipakai pada Debian 12. Workflow hanya memerlukan akses baca ke repositori dan menghasilkan artefak setelah tes MP4, MOV, dan WebM lulus.

Sumber resmi FFmpeg 9.1 diverifikasi dengan SHA-256 dan tanda tangan OpenPGP dari kunci rilis FFmpeg. Hasil build menggunakan demuxer MOV dan Matroska, protokol file, serta parser dan decoder bawaan untuk pembacaan metadata video. [Rilis FFmpeg](https://ffmpeg.org/download.html) · [Sumber 9.1](https://ffmpeg.org/releases/ffmpeg-9.1.tar.xz) · [Lisensi FFmpeg](https://ffmpeg.org/legal.html)

Arsip rilis berisi biner FFprobe, lisensi LGPL 2.1, tarball upstream asli, tanda tangan, kunci rilis, dan resep build. Berkas JSON pendamping berisi SHA-256 dan ukuran arsip, biner, sumber, serta lisensi untuk pematokan pemasang. Simpan arsip lengkap dan berkas JSON sebagai aset rilis yang dapat diunduh tanpa autentikasi.

Untuk membangun ulang dari arsip, ekstrak paket dan jalankan `bash BUILD-RECIPE.sh OUTPUT DIREKTORI_PAKET` pada Ubuntu 22.04 x64. Parameter kedua menunjuk direktori yang memuat tarball asli, tanda tangan, dan kunci. Tanpa parameter kedua, skrip mengunduh ketiganya dari FFmpeg.
