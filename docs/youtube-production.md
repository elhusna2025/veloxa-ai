# Studio produksi video YouTube

Studio utama membuat video dari topik, profil bisnis tersimpan, dan DNA Visual. Unggah video komputer merupakan fondasi terpisah; bukan alur utama produksi.

## Alur

1. Pilih Shorts satu menit (9:16) atau video panjang (16:9), durasi 15/30/60 atau khusus 1–120 menit. Pilih suara narator dan hingga lima pemeran fiksi dengan nama, ciri tetap, suara, serta gaya bicara.
2. Simpan satu operasi produksi. AI menyusun alur, kemudian menulis setiap blok satu menit: empat adegan, total 105–125 kata. Prompt per blok hanya memuat bab terdekat dan blok sebelumnya untuk membatasi konteks yang dikirim berulang.
3. Tinjau dan edit naskah tersimpan. Persetujuan naskah mengizinkan produksi media. Bila ada pemeran, buat satu portrait kanonis per pemeran, lalu minta tinjauan sebelum seluruh gambar adegan dibuat.
4. Foto tiap adegan menerima portrait pemeran yang tampak di adegan itu; dialog memakai ID pemeran dan suara yang sama. Narator dipisahkan. Saat ini suara menggunakan preset Realtime dan arahan pembawaan, belum cloning rekaman pribadi. Konsistensi wajah tetap memerlukan pemeriksaan hasil akhir.
5. Ukur teks dengan Inter bundel, periksa kontras pada ruang alami, lalu simpan foto dan overlay tetap. Buat dialog, ukur durasi per adegan, dan render zoom/pan serta crossfade 0,32 detik. Adegan gagal memakai pemulihan dengan jeda, tanpa menggandakan operasi atau mengulang seluruh produksi.
6. Encode per adegan ke MPEG-TS dengan timestamp berkelanjutan, lalu stream/remux seluruh segmen menjadi MP4 privat. Browser memutar via range request memakai cookie HttpOnly berumur 30 menit, yang hanya dapat dibuat melalui sesi Firebase pemilik. Tidak ada token akses Google di URL video.
7. Setelah video ditinjau, konfirmasi metadata, channel, deklarasi anak/media sintetis dan privasi. Server menautkan sumber MP4 produksi yang sudah selesai ke antrean resumable upload; browser tidak perlu mengunduh dan mengunggah ulang video. Satu produksi memakai satu ID pengiriman untuk mencegah publikasi ganda pada respons yang hilang.

## Operasi dan batas

- Koleksi `private_youtube_productions` memuat metadata kecil dan lease; naskah dan timing berada pada subkoleksi. Media privat memakai prefix `private-youtube-productions/`. Acuan pemeran dan frame yang sudah tersimpan dipakai kembali sesudah lease terputus.
- Persetujuan berhenti pada `script_review` dan `character_review`. Worker tidak membuat gambar/suara sebelum persetujuan terkait. `attention` mempertahankan hasil dan menyediakan lanjutkan operasi yang sama; kegagalan layanan tidak dijanjikan mustahil terjadi.
- Proses memakai satu lease per langkah dan memeriksa pemilik serta bisnis saat melanjutkan. Reservasi kuota draf dilakukan sekali melalui `youtube_production_quotas`, termasuk ketika melanjutkan pada hari berbeda.
- Scheduler per menit menjalankan satu langkah produksi, terisolasi dari lajur Otonom sosial dan unggah YouTube. Studio mempercepat langkah operasi yang sama saat terbuka.
- Model naskah, gambar dan suara mengikuti pengaturan server dan dibekukan pada operasi. Tidak menggunakan skill tim software engineering atau panggilan review tim untuk memproduksi video.
- Publish masih bergantung pada persetujuan izin unggah Google dan aktivasi retensi staging sebagaimana `youtube-connection.md`. File produksi privat dipertahankan untuk tinjauan; aturan lifecycle prefix staging unggah tidak menghapusnya.
- Uji lokal mencakup mesin status, idempotensi, isolasi bisnis/pemilik, persetujuan pemeran, preset suara per dialog, pengukuran teks, seek range, serta render H264/AAC nyata. Uji penyedia AI berbayar dan hasil multi-karakter live tetap harus dicatat terpisah; unit test bukan bukti kualitas wajah atau video 60 menit live.
