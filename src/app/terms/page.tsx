"use client";

import React, { useState } from "react";
import Link from "next/link";
import VeloxaDedicatedPageShell from "@/components/VeloxaDedicatedPageShell";
import { type VeloxaLocale } from "@/lib/veloxa-i18n";

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
      pageBadge={
        isId
          ? "DOKUMEN HUKUM RESMI · KEPATUHAN ENTERPRISE GLOBAL"
          : "OFFICIAL LEGAL AGREEMENT · GLOBAL ENTERPRISE COMPLIANCE"
      }
      pageTitle={
        isId
          ? "Syarat & Ketentuan Penggunaan (Terms of Use)"
          : "Terms of Use & Enterprise Service Agreement"
      }
      pageSubtitle={
        isId
          ? "Ketentuan hukum penggunaan studio konten AI otonom 4-kanal, kepemilikan 100% hak cipta aset brand, serta aturan keamanan AI Meta Ads di Veloxa AI."
          : "Governing terms for Veloxa AI's autonomous 4-channel content studio, 100% client IP ownership, and AI Meta Ads budget safety controls."
      }
    >
      {/* Top Summary Banner */}
      <div className="veloxa-luxury-card-pink rounded-[28px] p-6 sm:p-8 bg-white mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 mb-5 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-[#EC749B] px-3.5 py-1 text-xs font-extrabold text-white">
              v4.2 Enterprise Edition
            </span>
            <span className="text-xs font-bold text-neutral-500">
              {isId ? "Berlaku Efektif: 3 November 2026" : "Effective Date: November 3, 2026"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/privacy"
              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 hover:border-[#EC749B] hover:text-[#EC749B] transition"
            >
              {isId ? "Lihat Privacy Policy →" : "View Privacy Policy →"}
            </Link>
            <Link
              href="/register"
              className="veloxa-btn-pink rounded-xl px-4 py-2 text-xs font-extrabold"
            >
              {isId ? "Daftarkan Brand" : "Register Brand"}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#FBCFE0] bg-[#FFF9FB] p-4">
            <div className="text-xs font-extrabold uppercase tracking-wider text-[#EC749B]">
              {isId ? "100% HAK CIPTA KLIEN" : "100% CLIENT IP OWNERSHIP"}
            </div>
            <p className="mt-1 text-xs text-neutral-700 leading-relaxed">
              {isId
                ? "Semua foto asli yang Anda unggah dan seluruh video Reels, Carousel, & Poster hasil render AI adalah milik bisnis Anda sepenuhnya."
                : "All uploaded authentic photos and all AI-rendered Reels, Carousels, and Posters belong 100% to your brand."}
            </p>
          </div>
          <div className="rounded-2xl border border-[#FBCFE0] bg-[#FFF9FB] p-4">
            <div className="text-xs font-extrabold uppercase tracking-wider text-[#EC749B]">
              {isId ? "HARD BUDGET CAP IKLAN" : "HARD DAILY AD BUDGET CAP"}
            </div>
            <p className="mt-1 text-xs text-neutral-700 leading-relaxed">
              {isId
                ? "Agen AI Meta Ads dijamin secara sistem tidak pernah melebihi batas anggaran harian yang Anda tetapkan."
                : "The AI Meta Ads agent is programmatically locked from ever exceeding your configured daily spend cap."}
            </p>
          </div>
          <div className="rounded-2xl border border-[#FBCFE0] bg-[#FFF9FB] p-4">
            <div className="text-xs font-extrabold uppercase tracking-wider text-[#EC749B]">
              {isId ? "OAUTH RESMI & AMAN" : "OFFICIAL OAUTH 2.0 APIS"}
            </div>
            <p className="mt-1 text-xs text-neutral-700 leading-relaxed">
              {isId
                ? "Integrasi resmi Meta Graph API, TikTok API, & YouTube API v3. Cabut izin akses kapan saja dalam 1 klik."
                : "Official Meta Graph API, TikTok API, & YouTube API v3 integration. Revoke access anytime in 1 click."}
            </p>
          </div>
        </div>
      </div>

      {/* Detailed Legal Clauses */}
      <div className="space-y-6">
        {sections.map((sec) => (
          <article
            key={sec.id}
            className="veloxa-luxury-card rounded-[26px] p-6 sm:p-8 bg-white"
          >
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#FFF0F5] border border-[#FBCFE0] text-xs font-black text-[#EC749B]">
                {sec.id}
              </span>
              <div className="space-y-3 flex-1">
                <h2 className="text-lg sm:text-xl font-extrabold text-neutral-900">
                  {sec.title}
                </h2>
                <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                  {sec.body}
                </p>
                <ul className="space-y-2 pt-1">
                  {sec.bullets.map((bullet, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 text-xs sm:text-sm text-neutral-700"
                    >
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#EC749B]" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Bottom CTA Bar */}
      <div className="mt-8 veloxa-luxury-card rounded-[26px] p-6 sm:p-8 bg-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base sm:text-lg font-extrabold text-neutral-900">
            {isId
              ? "Pertanyaan Hukum atau Kepatuhan Enterprise?"
              : "Legal or Enterprise Compliance Questions?"}
          </h3>
          <p className="text-xs sm:text-sm text-neutral-600 mt-1">
            {isId
              ? "Tim Legal & Data Protection Officer kami siap membantu di legal@veloxa.ai"
              : "Our Legal & Data Protection Officer team is available at legal@veloxa.ai"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/privacy"
            className="rounded-2xl border border-neutral-200 bg-white px-5 py-3 text-xs sm:text-sm font-bold text-neutral-800 hover:border-[#EC749B] hover:text-[#EC749B] transition"
          >
            {isId ? "Baca Privacy Policy" : "Read Privacy Policy"}
          </Link>
          <Link
            href="/register"
            className="veloxa-btn-pink rounded-2xl px-6 py-3 text-xs sm:text-sm font-extrabold"
          >
            {isId ? "Setuju & Daftarkan Brand →" : "Accept & Register Brand →"}
          </Link>
        </div>
      </div>
    </VeloxaDedicatedPageShell>
  );
}
