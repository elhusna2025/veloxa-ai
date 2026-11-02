# Veloxa AI — Autonomous Multi-Channel Social Content & Meta Ads Marketing SaaS

Platform SaaS **100% TypeScript** lintas 3 platform (**Web**, **Android**, dan **iOS**) dengan 2 peran utama (**Role: USER Workspace** & **Role: SUPER ADMIN**).

## Fitur Utama

1. **Role: USER Workspace (Cafe, Event Lari, Klinik, Brand Lokal, Custom Bisnis)**
   - **Koneksi OAuth 1-Klik:** Instagram, Facebook Page, TikTok (Video & Photo Mode), YouTube Shorts, dan Meta Ads Manager (`act_...`).
   - **Brand Brain & Dual Asset Vault:**
     - **Laci 1 (Referensi Gaya):** Upload contoh foto/Reels impian → AI Vision mengekstrak *Style DNA* (layout, warna, tipografi, formula *hook*).
     - **Laci 2 (Galeri Aset Asli):** Upload foto menu cafe, dokumentasi pelari, medali, atau klip video asli dari Web maupun Kamera/Galeri HP Android & iOS.
   - **Studio Konten 4-Platform + Self-Healing Quality Gate:** Buat *Video Pendek 9:16 + Voiceover*, *Carousel 4:5*, atau *Post Tunggal* dengan pemeriksaan otomatis hingga 0 masalah.
   - **Agent Konten Otonom + Mode Kampanye Event:** User bebas mengatur frekuensi harian (`1x–4x/hari`), jam tayang WIB, mode *100% Full Otonom* vs *Co-Pilot H-1*, serta kalender hitung mundur event (*Teaser → Early Bird → Countdown → Hari-H*).
   - **AI Agent Marketing (Meta Ads Architect & Auto-Optimizer):**
     - Merancang & mengeksekusi **Demografi (usia, lokasi + radius km)**, **Interest resmi tervalidasi Meta API**, dan **Alokasi Budget** dengan **Pagar Pengaman Budget (*Hard Budget Cap*)**.
     - **Organic Winner Booster:** Mengubah konten organik yang sedang ramai menjadi kampanye Meta Ads dalam 1 klik.
     - **AI Media Buyer Auto-Optimizer:** Mematikan variasi iklan yang mahal secara otomatis dan mengalihkan 100% anggaran ke variasi pemenang.

2. **Role: SUPER ADMIN Command Center (Pemilik SaaS)**
   - Mengelola 3 paket langganan (**Starter Rp500.000**, **Growth Rp1.000.000**, **Pro + AI Meta Ads Rp1.500.000**).
   - Memantau **MRR**, **Biaya API aktual vs Pendapatan**, **Gross Margin (~84%)**, dan pemakaian kuota tiap pelanggan.
   - Mengelola **Brankas API & OAuth Terpusat** (OpenAI, Meta App, TikTok App, Google OAuth, Midtrans/Xendit).

## Perintah Menjalankan Aplikasi

```bash
# Jalankan Web Server (Port 3035)
npm run dev

# Jalankan Unit Tests & Pemeriksaan TypeScript
npm test
npm run typecheck
npm run functions:test

# Build & Sinkronisasi ke Android / iOS (Capacitor)
npm run cap:sync
npm run cap:open:android
npm run cap:open:ios
```
