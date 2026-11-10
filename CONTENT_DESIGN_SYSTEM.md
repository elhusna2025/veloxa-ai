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

Pada lebar tampilan 390 px, isi minimum menjadi sekitar 15,2 px dan CTA 14,4 px. Jangan menganggap piksel master sama dengan piksel layar. Jarak tambahan antarbaris adalah 24% ukuran font.

## Durasi Reels

- Reels mengikuti panjang pesan dengan durasi final 20–60 detik, bukan selalu 60 detik. Empat adegan membentuk satu cerita.
- Narasi 40–130 kata tetap luwes dan mengikuti gaya suara yang dipilih. Durasi akhir dibaca dari video aktual; estimasi naskah bukan bukti durasi final.
- Sisakan 0,2 detik di bawah batas encoding untuk padding AAC. Bila audio melewati target, sesuaikan tempo secara proporsional agar akhir narasi tetap termuat.

## Hierarki dan ruang

- Satu gagasan utama per slide; judul maksimal delapan kata/64 karakter. Isi pendukung maksimal 18 kata/125 karakter. Overlay Reels maksimal tujuh kata/48 karakter. Penjelasan rinci berada di caption atau voiceover.
- Judul dan isi tidak boleh bertabrakan dengan logo, panel screenshot, CTA, atau tepi gambar. Copy feed menempati area kiri 640 px; isi diberi tinggi 228 px, bukan dikecilkan agar muat di ruang sempit.
- Reels menyisakan 224 px di atas header dan setidaknya 320 px di bawah footer sebagai ruang antarmuka platform. Panel screenshot dan footer harus tetap terpisah.
- CTA memiliki area sendiri; website berada di baris terpisah. Jangan menumpuk dua baris CTA di atas domain.
- Foto tetap memenuhi kanvas. Gunakan scrim gelap di belakang copy agar tulisan putih terbaca pada foto terang. Target kontras minimum 4,5:1 untuk teks penting; CTA memakai tinta hitam/putih yang paling kontras dengan warna brand.
- Logo dan screenshot asli dipasang proporsional, tidak dipotong, digambar ulang, atau ditimpa teks.

## Overflow dan konsistensi

Seluruh judul, isi yang dicetak, CTA, dan domain pada satu batch diperiksa dengan pengukur teks compositor sebelum permintaan gambar atau voiceover berbayar dimulai. Caption lengkap dan narasi Reels tidak dibatasi sebagai paragraf visual. Ukuran font hanya boleh turun sampai batas token. Bila teks tetap tidak muat, hentikan komposisi dengan pesan yang jelas; jangan menghilangkan kata, memotong fakta, atau mengecilkan di bawah minimum. Agen diminta meringkas sebelum menghasilkan gambar; fakta, angka penting, dan makna harus dipertahankan. CTA panjang dapat menggunakan ajakan umum “Pelajari selengkapnya”; informasi lengkap tetap di caption.

Visual per slide mengikuti isi slide tersebut, dengan identitas warna dan arahan seni yang konsisten. Warna brand tidak berarti seluruh gambar harus menjadi blok warna atau latar putih. Reels menggunakan overlay pendek dan narasi audio, bukan paragraf pada setiap adegan.

## Verifikasi perubahan

Uji render asli memakai font bundel, bounds dan overflow, kontras foto terang, serta logo/screenshot tetap utuh. Tinjau hasil aktual pada lebar 390 px dan master; navigasi UI bukan bukti keterbacaan media. Hasil lama tidak berubah otomatis: aturan berlaku untuk render baru.
