# Design system konten Veloxa

Aturan ini untuk **media yang diekspor dan diposting**, berbeda dari ukuran font UI di DESIGN_SYSTEM.md. Berlaku pada post tunggal, setiap slide carousel, dan adegan Reels. Sumber token: `src/lib/content-typography.ts`.

## Ukuran dan keterbacaan

Master feed/carousel 1080 × 1350; master Reels 1080 × 1920, dikodekan ke video 720 × 1280. Ukuran berikut dalam piksel master 1080.

| Elemen | Feed/carousel | Reels | Batas minimum |
|---|---:|---:|---:|
| Judul | 80 | 88 | 64 / 72 |
| Isi pendukung | 46 | 46 | 42 |
| Nama bisnis | 40 | 40 | 34 |
| CTA | 44 | 44 | 40 |
| Domain website | 38 | 38 | 36 |

Pada lebar tampilan 390 px, isi minimum menjadi sekitar 15,2 px dan CTA 14,4 px. Jangan menganggap piksel master sama dengan piksel layar. Jarak tambahan antarbaris adalah 24% ukuran font, dengan 9% untuk judul Reels.

## Durasi Reels

- Reels mengikuti panjang pesan dengan durasi final 20–60 detik, bukan selalu 60 detik. Empat adegan membentuk satu cerita.
- Adegan pertama menampilkan judul utama yang menyebut topik secara konkret, sama dengan judul draf. Kalimat awal narasi mengenalkan topik sebelum masuk ke contoh atau detail. Tiga adegan berikutnya mengembangkan topik itu.
- Narasi 40–130 kata tetap luwes dan mengikuti gaya suara yang dipilih. Durasi akhir dibaca dari video aktual; estimasi naskah bukan bukti durasi final.
- Sisakan 0,2 detik di bawah batas encoding untuk padding AAC. Bila audio melewati target, sesuaikan tempo secara proporsional agar akhir narasi tetap termuat.
- Setiap adegan mempunyai judul singkat dan satu atau dua kalimat pendukung dari naskah yang sama dengan narasinya. Pakai teks pendukung yang lebih kecil dari judul dan tempatkan keduanya pada permukaan foto yang tenang. Untuk naskah lama yang panjang, tampilkan kalimat pembuka yang utuh sejauh muat dan pertahankan narasi lengkap.
- Gunakan narasi Indonesia seperti tutor yang sedang mengobrol. Beri ruang setelah pertanyaan, penekanan pada gagasan penting, dan nada yang lebih tenang saat menutup. Gunakan durasi suara per adegan dan letakkan transisi di jeda antarkalimat.
- Gerakkan foto pelan dengan zoom masuk, geser kiri dan kanan, lalu zoom keluar. Batasi zoom sekitar 9% dan lembutkan pergantian dengan crossfade sekitar 0,32 detik. Pasang teks, logo, dan screenshot sebagai lapisan tetap di area aman. Periksa kontras teks di seluruh jangkauan gerak foto.

## Hierarki dan ruang

- Satu gagasan utama per slide; judul feed dan carousel maksimal delapan kata/64 karakter, dengan isi pendukung maksimal 18 kata/125 karakter. Judul Reels maksimal tujuh kata/48 karakter; targetkan 10–20 kata pada teks pendukung.
- Judul dan isi tidak boleh bertabrakan dengan logo, panel screenshot, CTA, atau tepi gambar. Copy post tunggal menempati area kiri hingga 680 px. Pada draf carousel Studio, judul besar dan isi yang lebih pendek menyatu dengan foto. Tempatkan keduanya di ruang alami yang tenang dengan margin yang lega. Ukuran huruf tidak turun di bawah batas minimum.
- Reels menyisakan 224 px di atas header dan setidaknya 320 px di bawah footer sebagai ruang antarmuka platform. Panel screenshot dan footer harus tetap terpisah.
- CTA memiliki area sendiri; website berada di baris terpisah. Pada penutup Reels, kelompokkan CTA dan domain di bawah judul jika keduanya muat pada permukaan alami yang sama. Gunakan area penutup terpisah untuk judul panjang. Jangan menumpuk dua baris CTA di atas domain.
- Post tunggal dengan visual AI, draf carousel Studio, dan ketiga format Otonom memakai satu kanvas foto penuh. Letakkan teks gelap pada ruang alami yang terang, atau teks terang pada bagian foto yang secara alami gelap. Wajah, tangan, produk, dan layar tetap terlihat, termasuk pada adegan malam atau bernuansa neon. Aksen brand boleh masuk dari tepi atau menggarisbawahi judul. Hindari bayangan hitam, selubung putih, kotak teks, dan pembagian foto dengan pita teks. Target kontras minimum 4,5:1 untuk teks penting.
- Ukur judul Reels sebelum membuat foto. Rancang ruang judul sebagai permukaan alami yang menyatu dengan lokasi dan arah cahaya foto. Tempatkan subjek, wajah, tangan, dan produk di luar ruang tersebut. Saat menata teks, pilih area tenang terdekat dengan kontras alami minimal 4,5:1 sepanjang gerak kamera. Jika foto belum menyediakan ruang, coba ulang adegan itu dengan komposisi lebih sederhana dan referensi yang sama sebelum menyimpan video.
- Pada Otonom, nilai gambar akhir sesudah teks, logo, dan screenshot dipasang. Periksa juga tulisan promosi tambahan pada foto sumber. Simpan naskah, foto, suara, dan keputusan pemeriksaan per bagian pada proses yang sama. Gangguan layanan memicu pemeriksaan ulang gambar yang sama; penolakan visual memicu perbaikan bagian itu berdasarkan catatan pemeriksa. Lanjutkan pemulihan dengan jeda bertahap tanpa batas jumlah percobaan untuk pekerjaan yang diketahui belum terkirim, selama aturan dan izinnya masih berlaku. Kuota draf dihitung sekali per slot. Jika hasil pengiriman belum pasti, periksa status objek yang sama bila ID diketahui; jangan mengirim ulang tanpa kepastian.
- Model menyusun foto dan tipografi draf post tunggal dan carousel Studio sekaligus. Pada post tunggal, CTA dan domain mengikuti komposisi yang sama dalam bentuk teks. Tinjau ejaan, kontras, dan kesesuaian gambar pada ukuran ponsel sebelum menerbitkan.
- Logo dan screenshot asli dipasang proporsional, tidak dipotong, digambar ulang, atau ditimpa teks. Screenshot asli di carousel ditempatkan utuh dalam bingkai perangkat. Screenshot aplikasi yang dipilih sebagai acuan visual ikut dikirim sebagai gambar pada slide yang relevan. Arahkan tampilan aplikasi ke perangkat dalam adegan, atau gunakan detailnya sebagai inspirasi topik sesuai arahan pengguna. Foto referensi membentuk satu adegan yang utuh.
- Nomor slide dan petunjuk geser ada di navigasi Studio. Gambar carousel hanya menampilkan CTA dan alamat website pada slide penutup.
- Pada keempat adegan Reels, gunakan Inter ExtraBold untuk judul dan Inter Medium untuk nama bisnis, CTA, serta domain. Pakai satu ukuran judul dalam satu video. Gunakan tinta solid tanpa outline, dengan warna dari DNA Visual jika kontrasnya cukup. Tempatkan garis lengkung berwarna aksen di bawah judul. Gunakan sapuan kecil dari palet yang sama di sudut bawah, jauh dari teks, dan ulangi palet pada detail alami di setiap foto.
- Subjek, lokasi, dan benda dalam foto Reels mengikuti profil bisnis aktif, topik, dan referensi yang dipilih.

## Overflow dan konsistensi

Render Studio memeriksa judul, isi yang dicetak, CTA, dan domain dengan pengukur teks compositor sebelum permintaan gambar atau voiceover dimulai. Ukuran font hanya boleh turun sampai batas token. Untuk Reels Otonom, beri ruang tambahan bagi judul di area aman. Pindahkan teks yang tetap terlalu panjang ke caption secara utuh. Di Studio, tampilkan pesan bila teks tidak muat pada ukuran minimum. Agen diminta meringkas sebelum menghasilkan gambar dengan tetap mempertahankan fakta, angka penting, dan makna. CTA panjang dapat menggunakan ajakan umum “Pelajari selengkapnya”; informasi lengkap tetap di caption.

Visual per slide mengikuti isi slide tersebut, dengan identitas warna dan arahan seni yang konsisten. Warna brand tidak berarti seluruh gambar harus menjadi blok warna atau latar putih.

## Verifikasi perubahan

Uji render asli memakai font bundel, bounds dan overflow, kontras foto terang, serta logo/screenshot tetap utuh. Tinjau hasil aktual pada lebar 390 px dan master; navigasi UI bukan bukti keterbacaan media. Hasil lama tidak berubah otomatis: aturan berlaku untuk render baru.

## Video YouTube dan Shorts

- Produksi YouTube memakai naskah baru sesuai topik dan durasi yang dipilih, dengan alur pembahasan per menit. Target 105–125 kata per menit. Jumlah adegan mengikuti perubahan gagasan, objek, tindakan, dan konteks dalam narasi; tidak dipatok empat atau jumlah gambar lain. Ritme shot sekitar 3–8 detik menjadi arahan penyutradaraan, bukan kuota jumlah adegan. Shorts memakai kanvas 720 × 1280; video panjang 1280 × 720. Aturan empat adegan Reels tidak diterapkan pada YouTube/Shorts.
- Prompt gambar memakai ucapan narator pada adegan tersebut sebagai sumber utama subjek dan tindakan. Judul, profil bisnis, serta arahan gaya tidak boleh mengganti isi ucapan dengan visual generik atau ilustrasi bagian lain. Kirim arahan visual adegan bersama narasinya. Gunakan deskripsi adegan sebelumnya untuk kesinambungan objek dan lokasi. Buat komposisi baru untuk gagasan berikutnya dan lampirkan hanya potret acuan pemeran yang tampak. Batas pergantian gambar dihitung dari panjang PCM aktual untuk ucapan yang sama, termasuk jeda dialog, lalu dikuantisasi ke frame. Tampilkan rentang waktu aktual pada naskah setelah audio tersedia.
- Naskah, gambar acuan pemeran, gambar adegan, dialog, dan segmen video disimpan terpisah agar bagian yang sudah berhasil dapat dipakai kembali. Naskah serta acuan pemeran ditinjau sebelum produksi seluruh video. Progres menyebut bagian tersimpan; waktu selesai tidak diperkirakan tanpa bukti.
- Setiap dialog terikat pada ID pemeran dan pilihan suara yang sama sepanjang video. Foto adegan menerima gambar acuan kanonis semua karakter yang tampak di adegan itu, berikut nama dan ciri penampilannya. Kamera, ekspresi, dan tindakan boleh berubah; identitas wajah, rambut dan pakaian mengikuti acuan. Tetap tinjau hasil akhir untuk penyimpangan identitas.
- Produksi baru menampilkan gambar penuh dan takarir pendek dari narasi per adegan. Gaya awal berupa ilustrasi editorial semi-realistis dan dapat diarahkan melalui brief, termasuk fotografi. Takarir memakai Inter ExtraBold dengan garis tepi kontras di area bawah yang aman pada kedua rasio. Gambar pratinjau berupa ilustrasi bersih.
- Untuk melanjutkan produksi lama yang sudah memakai tata letak judul, tampilkan judul adegan dan teks pendukung. Nama bisnis aktif tidak dicetak sebagai label otomatis pada video YouTube atau Shorts. Judul dan teks pendukung diukur memakai Inter ExtraBold dan Inter Medium. Pilih tinta dan posisi tiap blok mengikuti terang-gelap foto di sekeliling huruf, dengan sasaran kontras 7:1 bila tersedia. Foto menyediakan ruang teks alami, dengan kontras minimum 4,5:1 di area gerak kamera. Lapisan tulisan tetap, foto bergerak pelan dengan zoom/pan maksimal 9% dan perpindahan lembut sekitar 0,32 detik. Palet dan objek mengikuti DNA serta konteks bisnis aktif.
- Untuk video dengan satu narator tanpa pemeran, rekam seluruh kalimat dalam setiap bagian satu menit melalui satu sesi dengan preset narator yang terkunci. Pakai cuplikan suara sintetis pembuka sebagai acuan bagian berikutnya. Sampaikan konteks alur kepada narator agar intonasi berlanjut antaradegan. Ukur ruang hening pada rekaman, lalu lengkapi jeda di kedua sisi perpindahan gambar. Beri pertanyaan dan penutup waktu lebih panjang. Pindahkan gambar mengikuti durasi ucapan dan jedanya.
- Dialog dapat berganti pembicara di dalam satu adegan. Ukur durasi PCM aktual tiap adegan sebelum menetapkan jumlah frame; sesuaikan tempo dalam rentang terbatas dan perbaiki suara yang terlalu jauh dari target. Simpan suara yang sudah disesuaikan sebagai PCM tanpa kehilangan data, lalu enkode AAC satu kali untuk seluruh video. Pembatas frame gambar tidak boleh menghentikan suara; jangan memulai ulang encoder audio pada pergantian gambar. Beri tahu bahwa suara menggunakan AI. Preset dan arahan pembawaan belum menyediakan peniruan rekaman pribadi.
- Video panjang dirender sebagai segmen terbatas lalu digabung melalui stream. Pratinjau MP4 privat memakai permintaan rentang byte sehingga browser tidak perlu mengunduh seluruh video sebelum memutar. Publikasi adalah konfirmasi terpisah, terikat ke channel dan izin unggah yang masih berlaku.
