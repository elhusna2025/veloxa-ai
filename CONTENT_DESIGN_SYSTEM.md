# Design system konten Veloxa

Aturan ini untuk **media yang diekspor dan diposting**, berbeda dari ukuran font UI di DESIGN_SYSTEM.md. Berlaku pada post tunggal, setiap slide carousel, dan adegan Reels. Sumber token: `src/lib/content-typography.ts`.

## Ukuran dan keterbacaan

Master feed/carousel 1080 × 1350; master Reels 1080 × 1920, dikodekan ke video 720 × 1280. Ukuran berikut dalam piksel master 1080.

| Elemen | Feed/carousel | Reels | Batas minimum |
|---|---:|---:|---:|
| Judul | 80 | 88 | 64 / 72 |
| Isi pendukung | 46 | lewat voiceover | 42 |
| Nama bisnis | 40 | 40 | 34 |
| CTA | 44 | 44 | 40 |
| Domain website | 38 | 38 | 36 |

Pada lebar tampilan 390 px, isi minimum menjadi sekitar 15,2 px dan CTA 14,4 px. Jangan menganggap piksel master sama dengan piksel layar. Jarak tambahan antarbaris adalah 24% ukuran font, dengan 9% untuk judul Reels.

## Durasi Reels

- Reels mengikuti panjang pesan dengan durasi final 20–60 detik, bukan selalu 60 detik. Empat adegan membentuk satu cerita.
- Adegan pertama menampilkan judul utama yang menyebut topik secara konkret, sama dengan judul draf. Kalimat awal narasi mengenalkan topik sebelum masuk ke contoh atau detail. Tiga adegan berikutnya mengembangkan topik itu.
- Narasi 40–130 kata tetap luwes dan mengikuti gaya suara yang dipilih. Durasi akhir dibaca dari video aktual; estimasi naskah bukan bukti durasi final.
- Sisakan 0,2 detik di bawah batas encoding untuk padding AAC. Bila audio melewati target, sesuaikan tempo secara proporsional agar akhir narasi tetap termuat.
- Gunakan narasi Indonesia seperti tutor yang sedang mengobrol. Beri ruang setelah pertanyaan, penekanan pada gagasan penting, dan nada yang lebih tenang saat menutup. Gunakan durasi suara per adegan dan letakkan transisi di jeda antarkalimat.
- Gerakkan foto pelan dengan zoom masuk, geser kiri dan kanan, lalu zoom keluar. Batasi zoom sekitar 9% dan lembutkan pergantian dengan crossfade sekitar 0,32 detik. Pasang teks, logo, dan screenshot sebagai lapisan tetap di area aman. Periksa kontras teks di seluruh jangkauan gerak foto.

## Hierarki dan ruang

- Satu gagasan utama per slide; judul maksimal delapan kata/64 karakter. Isi pendukung maksimal 18 kata/125 karakter. Overlay Reels maksimal tujuh kata/48 karakter. Penjelasan rinci berada di caption atau voiceover.
- Judul dan isi tidak boleh bertabrakan dengan logo, panel screenshot, CTA, atau tepi gambar. Copy post tunggal menempati area kiri hingga 680 px. Pada draf carousel Studio, judul besar dan isi yang lebih pendek menyatu dengan foto. Tempatkan keduanya di ruang alami yang tenang dengan margin yang lega. Ukuran huruf tidak turun di bawah batas minimum.
- Reels menyisakan 224 px di atas header dan setidaknya 320 px di bawah footer sebagai ruang antarmuka platform. Panel screenshot dan footer harus tetap terpisah.
- CTA memiliki area sendiri; website berada di baris terpisah. Jangan menumpuk dua baris CTA di atas domain.
- Post tunggal dengan visual AI, draf carousel Studio, dan ketiga format Otonom memakai satu kanvas foto penuh. Letakkan teks gelap pada ruang alami yang terang, atau teks terang pada bagian foto yang secara alami gelap. Wajah, tangan, produk, dan layar tetap terlihat, termasuk pada adegan malam atau bernuansa neon. Aksen brand boleh masuk dari tepi atau menggarisbawahi judul. Hindari bayangan hitam, selubung putih, kotak teks, dan pembagian foto dengan pita teks. Target kontras minimum 4,5:1 untuk teks penting.
- Ukur judul Reels sebelum membuat foto. Rancang ruang judul sebagai permukaan alami yang menyatu dengan lokasi dan arah cahaya foto. Tempatkan subjek, wajah, tangan, dan produk di luar ruang tersebut. Saat menata teks, pilih area tenang terdekat dengan kontras alami minimal 4,5:1 sepanjang gerak kamera. Jika foto belum menyediakan ruang, coba ulang adegan itu dengan komposisi lebih sederhana dan referensi yang sama sebelum menyimpan video.
- Pada Otonom, nilai gambar akhir sesudah teks, logo, dan screenshot dipasang. Periksa juga tulisan promosi tambahan pada foto sumber. Slot dapat dicoba ulang hingga tiga kali selama draf belum tersimpan dan jendela pemulihan masih terbuka. Jika hasil pengiriman belum pasti, periksa status objek yang sama bila ID diketahui.
- Model menyusun foto dan tipografi draf post tunggal dan carousel Studio sekaligus. Pada post tunggal, CTA dan domain mengikuti komposisi yang sama dalam bentuk teks. Tinjau ejaan, kontras, dan kesesuaian gambar pada ukuran ponsel sebelum menerbitkan.
- Logo dan screenshot asli dipasang proporsional, tidak dipotong, digambar ulang, atau ditimpa teks. Screenshot asli di carousel ditempatkan utuh dalam bingkai perangkat. Screenshot aplikasi yang dipilih sebagai acuan visual ikut dikirim sebagai gambar pada slide yang relevan. Arahkan tampilan aplikasi ke perangkat dalam adegan, atau gunakan detailnya sebagai inspirasi topik sesuai arahan pengguna. Foto referensi membentuk satu adegan yang utuh.
- Nomor slide dan petunjuk geser ada di navigasi Studio. Gambar carousel hanya menampilkan CTA dan alamat website pada slide penutup.
- Pada keempat adegan Reels, gunakan Inter ExtraBold untuk judul dan Inter Medium untuk nama bisnis, CTA, serta domain. Pakai satu ukuran judul dalam satu video. Gunakan tinta solid tanpa outline, dengan warna dari DNA Visual jika kontrasnya cukup. Tempatkan garis lengkung berwarna aksen di bawah judul. Gunakan sapuan kecil dari palet yang sama di sudut bawah, jauh dari teks, dan ulangi palet pada detail alami di setiap foto.
- Subjek, lokasi, dan benda dalam foto Reels mengikuti profil bisnis aktif, topik, dan referensi yang dipilih.

## Overflow dan konsistensi

Render Studio memeriksa judul, isi yang dicetak, CTA, dan domain dengan pengukur teks compositor sebelum permintaan gambar atau voiceover dimulai. Ukuran font hanya boleh turun sampai batas token. Untuk Reels Otonom, beri ruang tambahan bagi judul di area aman. Pindahkan teks yang tetap terlalu panjang ke caption secara utuh. Di Studio, tampilkan pesan bila teks tidak muat pada ukuran minimum. Agen diminta meringkas sebelum menghasilkan gambar dengan tetap mempertahankan fakta, angka penting, dan makna. CTA panjang dapat menggunakan ajakan umum “Pelajari selengkapnya”; informasi lengkap tetap di caption.

Visual per slide mengikuti isi slide tersebut, dengan identitas warna dan arahan seni yang konsisten. Warna brand tidak berarti seluruh gambar harus menjadi blok warna atau latar putih. Reels menggunakan overlay pendek dan narasi audio, bukan paragraf pada setiap adegan.

## Verifikasi perubahan

Uji render asli memakai font bundel, bounds dan overflow, kontras foto terang, serta logo/screenshot tetap utuh. Tinjau hasil aktual pada lebar 390 px dan master; navigasi UI bukan bukti keterbacaan media. Hasil lama tidak berubah otomatis: aturan berlaku untuk render baru.
