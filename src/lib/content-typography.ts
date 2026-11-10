/** Export pixels on a 1080 px master, not application CSS pixels. */
export const CONTENT_TYPOGRAPHY = {
 feedTitle: { max: 80, min: 64 },
 reelsTitle: { max: 88, min: 72 },
 body: { max: 46, min: 42 },
 brand: { max: 40, min: 34 },
 cta: { max: 44, min: 40 },
 website: { max: 38, min: 36 },
 lineGapRatio: 0.24,
} as const;
export const CONTENT_COPY_INSTRUCTION = 'Teks visual memakai ukuran minimum agar terbaca di layar ponsel. Judul maksimal 8 kata dan 64 karakter; isi pendukung satu gagasan maksimal 18 kata dan 125 karakter; overlay Reels maksimal 7 kata dan 48 karakter. Letakkan penjelasan lebih panjang di caption atau voiceover. Pertahankan fakta, angka penting, dan makna saat meringkas; jangan memotong kata atau kalimat. CTA visual singkat; URL berasal dari website bisnis tersimpan.';
