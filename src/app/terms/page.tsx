"use client";

import { useState } from "react";
import VeloxaDedicatedPageShell from "@/components/VeloxaDedicatedPageShell";
import { type VeloxaLocale } from "@/lib/veloxa-i18n";
import { VeloxaLegalDocument, legalContactEmail } from "@/components/VeloxaLegalDocument";
import styles from "@/components/VeloxaDedicatedPageShell.module.css";
import authStyles from "@/components/VeloxaAuthScreen.module.css";

export default function VeloxaTermsOfUsePage() {
  const [locale, setLocale] = useState<VeloxaLocale>("id");
  const isId = locale === "id";

  const sections = isId
    ? [
        {
          id: "01",
          title: "1. Ruang Lingkup Layanan & Ketentuan Penggunaan Akun",
          body: "Veloxa AI adalah platform Software-as-a-Service (SaaS) multi-tenant global yang menyediakan studio produksi konten sosial media otonom (Reels 9:16, Carousel 4:5, Feed Poster, AI Voiceover, dan Subtitle Otomatis), penerbitan terjadwal ke 4 kanal resmi (Instagram, Facebook Page, TikTok, dan YouTube Shorts), serta agen optimasi iklan Meta Ads. Dengan mendaftar atau menggunakan layanan Veloxa AI di Web, Android, atau iOS, Anda menyetujui ketentuan hukum ini.",
          bullets: [
            "Setiap workspace bisnis (tenant) terisolasi secara kriptografis dan hanya dapat diakses oleh pemilik brand serta anggota tim yang diundang secara sah.",
            "Pengguna wajib berusia minimal 18 tahun atau mewakili badan usaha/organisasi yang sah secara hukum.",
            "Satu akun langganan berlaku lintas perangkat (Web Desktop, Android Native, dan iOS Native) sesuai kuota paket yang dipilih.",
          ],
        },
        {
          id: "02",
          title: "2. Kepemilikan Hak Kekayaan Intelektual (100% Hak Milik Klien)",
          body: "Veloxa AI menjamin perlindungan penuh atas aset kreatif dan kekayaan intelektual bisnis Anda:",
          bullets: [
            "Kepemilikan Aset Asli (Real Asset Vault): Seluruh foto produk, dokumentasi event, logo, maskot, dan video mentah yang Anda unggah tetap 100% menjadi hak milik eksklusif bisnis Anda.",
            "Kepemilikan Hasil Produksi AI: Seluruh karya akhir berupa video Reels 9:16, slide Carousel 4:5, poster, copywriting caption, dan voiceover yang dihasilkan untuk workspace Anda menjadi hak milik komersial penuh bisnis Anda tanpa royalti tambahan.",
            "Garansi 0% Pelatihan Model Publik: Aset di dalam Real Asset Vault dan Style Reference Vault Anda TIDAK PERNAH dijual, dibagikan ke tenant lain, atau digunakan untuk melatih model AI publik.",
          ],
        },
        {
          id: "03",
          title: "3. Otorisasi Resmi 4-Kanal Sosial Media (Official OAuth 2.0)",
          body: "Veloxa AI terhubung ke akun sosial media bisnis Anda semata-mata menggunakan protokol OAuth 2.0 resmi dari masing-masing platform:",
          bullets: [
            "Meta Graph API (Instagram Professional & Facebook Page), TikTok Content Posting API (Video & Photo Mode), dan YouTube Data API v3 (Shorts).",
            "Veloxa AI hanya mempublikasikan konten atau menjalankan penjadwalan Autopilot sesuai frekuensi (1x–4x sehari) dan kalender yang Anda aktifkan.",
            "Anda memegang kendali penuh untuk mencabut akses OAuth kapan saja melalui dasbor Veloxa AI maupun langsung dari pengaturan keamanan akun Instagram, Facebook, TikTok, atau Google Anda.",
          ],
        },
        {
          id: "04",
          title: "4. Aturan AI Meta Ads Agent & Batas Anggaran Harian (Hard Budget Cap)",
          body: "Apabila Anda mengaktifkan fitur AI Meta Ads Marketing Agent di dalam workspace Veloxa AI:",
          bullets: [
            "Batas Anggaran Harian Ketat (Hard Daily Spend Cap): Agen AI tidak akan pernah melampaui batas anggaran iklan harian maksimum yang Anda tetapkan di dalam pengaturan kampanye.",
            "Aturan Auto-Pause & Re-Alokasi: Sistem secara otomatis menghentikan variasi iklan yang melewati ambang Cost-Per-Result maksimum dan mengalihkan anggaran ke variasi kreatif dengan ROAS tertinggi.",
            "Biaya iklan (ad spend) ditagihkan langsung oleh Meta Platforms, Inc. melalui metode pembayaran yang terdaftar di Meta Ads Manager Anda, terpisah dari biaya langganan bulanan perangkat lunak Veloxa AI.",
          ],
        },
        {
          id: "05",
          title: "5. Langganan, Pembayaran Web, & Kebijakan Pembatalan",
          body: "Veloxa AI menawarkan 3 paket langganan transparan: Starter Creator (Rp500.000 / $39 per bulan), Growth Business + AI Ads (Rp990.000 / $79 per bulan), dan Agency / Event Pro (Rp1.850.000 / $149 per bulan).",
          bullets: [
            "Bebas Komisi App Store 30%: Seluruh pemrosesan langganan dilakukan melalui portal web terenkripsi Veloxa AI (Midtrans, Xendit, atau Stripe Global), sedangkan aplikasi Android dan iOS berfungsi sebagai pendamping (companion reader/controller app) tanpa markup harga.",
            "Fleksibilitas Pembatalan: Anda dapat meningkatkan paket (upgrade), menurunkan paket (downgrade), atau membatalkan perpanjangan otomatis kapan saja tanpa denda penalti.",
            "Quality Gate 99/100: Setiap aset yang gagal melewati audit kualitas otomatis 99/100 (Self-Healing Retry Loop) akan diperbaiki oleh sistem tanpa memotong kuota publikasi harian Anda.",
          ],
        },
        {
          id: "06",
          title: "6. Larangan Penggunaan & Kepatuhan Konten",
          body: "Pengguna dilarang menggunakan Veloxa AI untuk memproduksi atau menyebarkan konten yang:",
          bullets: [
            "Melanggar hukum yang berlaku, mengandung penipuan (scam/phishing), ujaran kebencian, atau pelanggaran hak cipta pihak ketiga.",
            "Melanggar Kebijakan Komunitas dan Kebijakan Periklanan resmi dari Meta (Instagram/Facebook), TikTok, maupun YouTube.",
            "Mencoba melakukan rekayasa balik (reverse engineering), penyalahgunaan API, atau mengganggu stabilitas infrastruktur multi-tenant Veloxa AI.",
          ],
        },
      ]
    : [
        {
          id: "01",
          title: "1. Scope of Services & Workspace Account Terms",
          body: "Veloxa AI is a global multi-tenant Software-as-a-Service (SaaS) platform providing an autonomous social media production studio (9:16 Reels, 4:5 Carousels, Feed Posters, AI Voiceover, and Auto-Subtitles), scheduled publishing across 4 official channels (Instagram, Facebook Page, TikTok, and YouTube Shorts), and an autonomous AI Meta Ads Marketing Agent. By registering or using Veloxa AI across Web, Android, or iOS, you agree to these Terms of Use.",
          bullets: [
            "Each brand workspace (tenant) is cryptographically isolated and accessible strictly by authorized brand owners and invited team members.",
            "Users must be at least 18 years old or legally authorized to bind the business or organization they represent.",
            "A single subscription grants seamless access across Web Desktop, Native Android, and Native iOS apps according to your selected plan tier.",
          ],
        },
        {
          id: "02",
          title: "2. Intellectual Property & 100% Client Asset Ownership",
          body: "Veloxa AI guarantees complete commercial ownership and protection for your brand assets:",
          bullets: [
            "Real Asset Vault Ownership: All authentic product photos, event photography, logos, mascots, and raw footage you upload remain 100% the exclusive property of your business.",
            "Generated Creative Ownership: All final 9:16 Reels videos, 4:5 Carousel slides, posters, captions, and voiceovers generated for your workspace belong 100% to your brand for unrestricted commercial use.",
            "0% Public Model Training Guarantee: Assets inside your Real Asset Vault and Style Reference Vault are NEVER sold, shared across tenants, or used to train public AI models.",
          ],
        },
        {
          id: "03",
          title: "3. Official 4-Channel Social OAuth Authorization",
          body: "Veloxa AI connects to your social media channels exclusively via official OAuth 2.0 APIs:",
          bullets: [
            "Meta Graph API (Instagram Professional & Facebook Page), TikTok Content Posting API (Video & Photo Mode), and YouTube Data API v3 (Shorts).",
            "Veloxa AI only publishes or schedules posts according to the Autopilot cadence (1x–4x daily) and campaign settings you explicitly configure.",
            "You retain full control to revoke OAuth permissions at any time from your Veloxa AI dashboard or directly within your Instagram, Facebook, TikTok, or Google account security settings.",
          ],
        },
        {
          id: "04",
          title: "4. AI Meta Ads Agent Governance & Hard Daily Budget Cap",
          body: "When you activate the AI Meta Ads Marketing Agent inside your Veloxa AI workspace:",
          bullets: [
            "Strict Hard Daily Spend Cap: The autonomous media buyer agent is programmatically restricted from ever exceeding the maximum daily ad budget cap you define.",
            "Automated Pause & Reallocation Rules: Underperforming ad creatives exceeding your maximum Cost-Per-Result threshold are paused automatically, reallocating budget to winning creatives.",
            "Media ad spend is billed directly by Meta Platforms, Inc. via the payment method configured in your Meta Ads Manager, separate from your Veloxa AI software subscription.",
          ],
        },
        {
          id: "05",
          title: "5. Subscription Plans, Web Billing, & Cancellation Policy",
          body: "Veloxa AI offers 3 transparent subscription tiers: Starter Creator ($39 / Rp500,000 per month), Growth Business + AI Ads ($79 / Rp990,000 per month), and Agency / Event Pro ($149 / Rp1,850,000 per month).",
          bullets: [
            "Zero 30% App Store Commission Markup: All subscription billing is processed securely on the web via Stripe Global, Midtrans, or Xendit, while native Android and iOS apps operate as companion reader/controller apps.",
            "Cancel Anytime Flexibility: You may upgrade, downgrade, or cancel auto-renewal at any time from your workspace billing settings without cancellation penalties.",
            "99/100 Self-Healing Quality Gate: Any generated draft that fails our automated 99/100 visual and copywriting inspection is regenerated automatically at zero cost to your daily quota.",
          ],
        },
        {
          id: "06",
          title: "6. Acceptable Use & Platform Compliance",
          body: "You agree not to use Veloxa AI to generate, schedule, or distribute content that:",
          bullets: [
            "Violates applicable laws, promotes fraud/deceptive practices, hate speech, or infringes third-party intellectual property rights.",
            "Violates the official Community Guidelines or Advertising Policies of Meta (Instagram/Facebook), TikTok, or YouTube.",
            "Attempts to reverse-engineer, bypass tenant security boundaries, or abuse platform API rate limits.",
          ],
        },
      ];

  return (
    <VeloxaDedicatedPageShell
      activePage="terms"
      locale={locale}
      onLocaleChange={setLocale}
      pageTitle={isId ? "Syarat dan Ketentuan" : "Terms of Use"}
      pageSubtitle={isId ? "Ketentuan penggunaan akun dan layanan Veloxa AI." : "The terms for using your Veloxa AI account and services."}
    >
      <VeloxaLegalDocument page="terms" isId={isId} sections={sections}>
        <section className={styles.contact} aria-labelledby="legal-contact">
          <h2 id="legal-contact">{isId ? "Pertanyaan tentang ketentuan?" : "Questions about these terms?"}</h2>
          <a className={`${authStyles.secondary} ${styles.action}`} href={`mailto:${legalContactEmail}`}>{legalContactEmail}</a>
        </section>
      </VeloxaLegalDocument>
    </VeloxaDedicatedPageShell>
  );
}
