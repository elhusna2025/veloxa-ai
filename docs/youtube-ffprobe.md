# FFprobe untuk Studio YouTube

Pemeriksaan file unggahan Studio YouTube memakai FFprobe yang dipatok per platform. `npm ci` menjalankan pemasang pada Linux x64 dan macOS Intel. Jalankan `npm run postinstall` untuk menyiapkan cache dari instalasi dependensi yang sudah ada. Linux memerlukan `tar` dengan dukungan XZ. macOS memerlukan `unzip`.

Pemasang mencocokkan SHA-256 dan ukuran arsip sebelum mengambil file dari arsip, lalu mencocokkan SHA-256 biner sebelum menjalankannya. Biner dan pemberitahuan lisensi disimpan di `node_modules/.veloxa-youtube-ffprobe`. Server mencocokkan kembali biner dengan checksum yang dipatok. Platform dengan biner yang belum tersedia menerima status layanan tidak tersedia saat pemeriksaan video.

- Linux x64 memakai FFprobe 9.1 LGPL hasil build Veloxa dari tarball FFmpeg resmi yang diverifikasi checksum dan tanda tangan rilisnya. Paket rilis menyertakan sumber lengkap asli, tanda tangan, lisensi, dan resep build; pemeriksaan MP4, MOV, dan WebM berjalan pada Linux sebelum paket diterbitkan. [Artefak dan sumber](https://github.com/elhusna2025/veloxa-ai/releases/tag/youtube-ffprobe-9.1-1) · [Build dan pengujian Linux](https://github.com/elhusna2025/veloxa-ai/actions/runs/44983401666) · [Resep build](build-youtube-ffprobe.md)
- macOS Intel memakai build FFprobe 9.1 dari Martin Riedl untuk pengembangan lokal. Pemasang menyimpan pemberitahuan lisensi FFprobe bersama biner. [Rilis vendor](https://ffmpeg.martin-riedl.de/info/detail/macos/amd64/1795212433_9.1) · [Skrip build vendor](https://git.martin-riedl.de/ffmpeg/build-script) · [Rilis sumber FFmpeg](https://ffmpeg.org/releases/ffmpeg-9.1.tar.xz)

Saat memperbarui build, ganti URL rilis, ukuran, dan checksum pada `scripts/youtube-ffprobe-artifacts.json`. Verifikasi checksum arsip terhadap penerbit sebelum mencatat checksum biner dari arsip tersebut. Uji `npm run postinstall` dan unggahan contoh dengan video biasa serta video yang memiliki metadata rotasi.
