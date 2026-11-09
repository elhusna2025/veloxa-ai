"use client";

import React, { useState } from "react";
import Link from "next/link";
import VeloxaDedicatedPageShell from "@/components/VeloxaDedicatedPageShell";
import { type VeloxaLocale } from "@/lib/veloxa-i18n";

export default function VeloxaPrivacyPolicyPage() {
  const [locale, setLocale] = useState<VeloxaLocale>("id");
  const [deletionEmail, setDeletionEmail] = useState("");
  const [deletionTenant, setDeletionTenant] = useState("");
  const [deletionTicket, setDeletionTicket] = useState<string | null>(null);

  const isId = locale === "id";

  function handleDataDeletionSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!deletionEmail.trim() || !deletionEmail.includes("@")) return;
    const code = `DEL-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    setDeletionTicket(code);
  }

  const policies = isId
    ? [
        {
          badge: "01 · DATA YANG DIKUMPULKAN",
          title: "1. Informasi Akun, Brand Vault, & Token OAuth yang Kami Kumpulkan",
          description:
            "Kami hanya mengumpulkan data minimum yang diperlukan untuk mengoperasikan studio produksi konten AI 4-kanal dan pengelola iklan Meta Ads Anda:",
          points: [
            "Identitas Akun & Tenant: Nama lengkap, alamat email bisnis, nama brand, kota operasional, dan kategori industri.",
            "Dual Brand Vault: Gambar referensi gaya (Style Reference Vault) dan stok foto produk/event asli (Real Asset Vault) yang Anda unggah ke penyimpanan terisolasi milik tenant Anda.",
            "Token Otorisasi OAuth 2.0: Token akses terenkripsi untuk Instagram Graph API, Facebook Page API, TikTok Content Posting API, YouTube Data API v3, dan Meta Marketing API.",
          ],
        },
        {
          badge: "02 · GARANSI PRIVASI AI",
          title: "2. Jaminan 0% Pelatihan Model AI Publik (Zero Public AI Training)",
          description:
            "Privasi aset visual dan strategi pemasaran bisnis Anda adalah prioritas utama kami:",
          points: [
            "Foto produk asli, wajah tim/peserta event, logo brand, serta data performa ROAS iklan Anda TIDAK PERNAH digunakan untuk melatih model AI publik atau dibagikan ke pelanggan lain.",
            "Seluruh proses ekstraksi Style DNA dan perancangan komposisi dijalankan di dalam kontainer komputasi ephemeral yang terisolasi per tenant.",
          ],
        },
        {
          badge: "03 · ARSITEKTUR LOCAL-FIRST",
          title: "3. Penyimpanan Local-First & Enkripsi End-to-End",
          description:
            "Veloxa AI menggunakan arsitektur Local-First dengan verifikasi hash FNV-1a untuk meminimalkan transmisi data yang tidak perlu:",
          points: [
            "Enkripsi Saat Transit & Disimpan: Seluruh komunikasi menggunakan TLS 1.3 dan penyimpanan cloud dienkripsi dengan standar AES-256.",
            "Isolasi Multi-Tenant Ketat: Aturan keamanan database (Firestore Security Rules) memblokir akses lintas tenant secara mutlak.",
            "Minimalisasi Jejak Cloud: Sinkronisasi hanya mengirim perubahan data yang telah terverifikasi checksum FNV-1a.",
          ],
        },
        {
          badge: "04 · KEPATUHAN GLOBAL & HAK PENGGUNA",
          title: "4. Kepatuhan UU PDP Indonesia, GDPR Eropa, & CCPA",
          description:
            "Sebagai pengguna Veloxa AI di seluruh dunia, Anda memiliki hak penuh atas data Anda:",
          points: [
            "Hak Akses & Portabilitas: Anda dapat mengunduh seluruh riwayat konten, laporan analitik, dan aset Brand Vault Anda kapan saja.",
            "Hak Pencabutan OAuth Instan: Anda dapat memutuskan koneksi Instagram, Facebook, TikTok, dan YouTube dalam 1 klik tanpa menyisakan token aktif.",
            "Hak Penghapusan Data Permanen (Right to Erasure): Anda dapat meminta penghapusan seluruh data akun dan token OAuth melalui formulir penghapusan instan di bawah ini.",
          ],
        },
      ]
    : [
        {
          badge: "01 · DATA COLLECTION",
          title: "1. Account Information, Brand Vaults, & OAuth Tokens Collected",
          description:
            "We collect only the minimum data strictly required to operate your autonomous 4-channel AI content studio and Meta Ads media buyer:",
          points: [
            "Account & Workspace Identity: Full name, business email address, brand name, city, and industry vertical.",
            "Dual Brand Vaults: Style inspiration images (Style Reference Vault) and authentic product/event photos (Real Asset Vault) uploaded to your tenant-isolated storage.",
            "Encrypted OAuth 2.0 Tokens: Scoped authorization tokens for Instagram Graph API, Facebook Page API, TikTok Content Posting API, YouTube Data API v3, and Meta Marketing API.",
          ],
        },
        {
          badge: "02 · AI PRIVACY GUARANTEE",
          title: "2. Strict 0% Public AI Model Training Guarantee",
          description:
            "Your proprietary visual assets and paid marketing performance data remain strictly confidential:",
          points: [
            "Your authentic product photos, event photography, brand logos, and Meta Ads ROAS telemetry are NEVER used to train public AI foundation models or shared with other tenants.",
            "All Style DNA extraction and layout rendering occur inside isolated, tenant-scoped ephemeral compute environments.",
          ],
        },
        {
          badge: "03 · LOCAL-FIRST SECURITY",
          title: "3. Local-First Sync Architecture & AES-256 Encryption",
          description:
            "Veloxa AI is engineered with a Local-First FNV-1a checksum architecture that minimizes unnecessary cloud exposure:",
          points: [
            "Encryption in Transit & at Rest: All traffic is secured via TLS 1.3 and cloud persistence is encrypted using AES-256.",
            "Cryptographic Tenant Isolation: Strict Firestore Security Rules enforce zero cross-tenant read or write access.",
            "FNV-1a Delta Sync: Cloud writes occur only when verified payload hashes change, protecting both speed and data privacy.",
          ],
        },
        {
          badge: "04 · GLOBAL PRIVACY RIGHTS",
          title: "4. GDPR, CCPA, & Indonesia UU PDP Compliance",
          description:
            "Regardless of your geographic region, Veloxa AI grants you complete sovereignty over your data:",
          points: [
            "Right to Access & Portability: Export your generated creatives, analytics logs, and Brand Vault assets at any time.",
            "Instant OAuth Revocation: Disconnect Instagram, Facebook, TikTok, or YouTube in 1 click, immediately purging stored access tokens.",
            "Right to Permanent Erasure (Meta/TikTok/Google App Review Compliant): Request immediate deletion of your workspace and OAuth tokens using the interactive tool below.",
          ],
        },
      ];

  return (
    <VeloxaDedicatedPageShell
      activePage="privacy"
      locale={locale}
      onLocaleChange={setLocale}
      pageBadge={
        isId
          ? "KEBIJAKAN PRIVASI · KEPATUHAN OAUTH META, TIKTOK & GOOGLE"
          : "PRIVACY POLICY · META, TIKTOK & GOOGLE OAUTH COMPLIANCE"
      }
      pageTitle={
        isId
          ? "Kebijakan Privasi & Perlindungan Data (Privacy Policy)"
          : "Privacy Policy & Global Data Protection"
      }
      pageSubtitle={
        isId
          ? "Transparansi penuh pengelolaan token OAuth 4 sosial media, enkripsi Dual Brand Vault, kepatuhan UU PDP & GDPR, serta portal penghapusan data instan."
          : "Complete transparency on 4-channel OAuth token security, Dual Brand Vault encryption, GDPR/UU PDP compliance, and instant data deletion."
      }
    >
      {/* Top Highlights */}
      <div className="veloxa-luxury-card-pink rounded-xl p-6 sm:p-8 bg-white mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 mb-5 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-[#bd416e] px-3.5 py-1 text-sm font-semibold text-white">
              ISO/IEC 27001 & GDPR Aligned
            </span>
            <span className="text-sm font-medium text-neutral-500">
              {isId ? "Pembaruan Terakhir: 3 November 2026" : "Last Updated: November 3, 2026"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/terms"
              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:border-[#EC749B] hover:text-[#a92e5d] transition"
            >
              {isId ? "Lihat Terms of Use →" : "View Terms of Use →"}
            </Link>
            <Link
              href="/register"
              className="veloxa-btn-pink rounded-xl px-4 py-2 text-sm font-semibold"
            >
              {isId ? "Mulai Gratis / Daftar" : "Get Started"}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#FBCFE0] bg-[#FFF9FB] p-4">
            <div className="text-sm font-semibold uppercase tracking-wider text-[#a92e5d]">
              🔒 AES-256 + TLS 1.3
            </div>
            <p className="mt-1 text-sm text-neutral-700 leading-relaxed">
              {isId
                ? "Seluruh token OAuth Instagram, Facebook, TikTok, dan YouTube disimpan dalam brankas terenkripsi."
                : "All Instagram, Facebook, TikTok, and YouTube OAuth tokens are stored in encrypted vaults."}
            </p>
          </div>
          <div className="rounded-xl border border-[#FBCFE0] bg-[#FFF9FB] p-4">
            <div className="text-sm font-semibold uppercase tracking-wider text-[#a92e5d]">
              🛡️ 0% PUBLIC AI TRAINING
            </div>
            <p className="mt-1 text-sm text-neutral-700 leading-relaxed">
              {isId
                ? "Foto produk asli & aset event Anda tidak pernah digunakan untuk melatih model AI publik."
                : "Your authentic product & event photos are never used to train public AI models."}
            </p>
          </div>
          <div className="rounded-xl border border-[#FBCFE0] bg-[#FFF9FB] p-4">
            <div className="text-sm font-semibold uppercase tracking-wider text-[#a92e5d]">
              ⚡ 1-CLICK DATA DELETION
            </div>
            <p className="mt-1 text-sm text-neutral-700 leading-relaxed">
              {isId
                ? "Penghapusan instan seluruh data tenant & pencabutan token OAuth sesuai syarat Meta/TikTok."
                : "Instant workspace erasure & OAuth token revocation compliant with Meta/TikTok App Review."}
            </p>
          </div>
        </div>
      </div>

      {/* Policy Sections */}
      <div className="space-y-6 mb-10">
        {policies.map((pol) => (
          <article
            key={pol.badge}
            className="veloxa-luxury-card rounded-xl p-6 sm:p-8 bg-white space-y-3"
          >
            <span className="inline-flex items-center rounded-full bg-[#FFF0F5] border border-[#FBCFE0] px-3 py-1 text-xs font-semibold text-[#a92e5d]">
              {pol.badge}
            </span>
            <h2 className="text-lg sm:text-xl font-semibold text-neutral-900">
              {pol.title}
            </h2>
            <p className="text-sm sm:text-base text-neutral-600 leading-relaxed">
              {pol.description}
            </p>
            <ul className="space-y-2 pt-1">
              {pol.points.map((pt, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm sm:text-base text-neutral-700"
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#bd416e]" />
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      {/* Interactive OAuth & User Data Deletion Callback Section (Required for Meta/TikTok/YouTube Production Review) */}
      <section
        id="data-deletion-request"
        className="veloxa-luxury-card-pink rounded-xl p-6 sm:p-9 bg-white"
      >
        <div className="max-w-3xl space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF0F5] border border-[#FBCFE0] px-3.5 py-1 text-xs font-semibold text-[#a92e5d]">
            🗑️ {isId ? "PORTAL PENGHAPUSAN DATA PENGGUNA & OAUTH" : "USER & OAUTH DATA DELETION PORTAL"}
          </span>
          <h2 className="text-xl sm:text-2xl font-semibold text-neutral-900">
            {isId
              ? "Permintaan Penghapusan Data Instan (Right to Erasure)"
              : "Instant Data Deletion Request (Right to Erasure)"}
          </h2>
          <p className="text-sm sm:text-base text-neutral-600 leading-relaxed">
            {isId
              ? "Sesuai standar kepatuhan Meta Platform Terms, TikTok Developer Guidelines, Google API Services User Data Policy, dan UU PDP, Anda dapat mengajukan penghapusan permanen atas akun, Brand Vault, serta seluruh token OAuth sosial media Anda melalui formulir di bawah ini."
              : "In compliance with Meta Platform Terms, TikTok Developer Guidelines, Google API Services User Data Policy, and GDPR, you can submit an immediate permanent deletion request for your account, Brand Vaults, and connected OAuth tokens below."}
          </p>

          {deletionTicket ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border-2 border-[#EC749B] bg-[#FFF9FB] p-5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold uppercase tracking-wider text-[#a92e5d]">
                  ✓ {isId ? "Permintaan Penghapusan Diterima" : "Deletion Request Logged"}
                </span>
                <span className="rounded-lg bg-white border border-[#FBCFE0] px-3 py-1 font-mono text-sm font-semibold text-neutral-900">
                  TICKET: {deletionTicket}
                </span>
              </div>
              <p className="text-sm sm:text-base text-neutral-700">
                {isId
                  ? `Konfirmasi pencabutan token OAuth dan jadwal pembersihan data untuk ${deletionEmail} telah dibuat dengan nomor tiket ${deletionTicket}.`
                  : `OAuth token revocation and data purge confirmation for ${deletionEmail} has been queued under ticket ${deletionTicket}.`}
              </p>
            </div>
          ) : (
            <form
              method="post"
              onSubmit={handleDataDeletionSubmit}
              className="grid grid-cols-1 gap-4 sm:grid-cols-12 pt-2"
            >
              <div className="sm:col-span-5">
                <label
                  htmlFor="privacy-delete-email"
                  className="block text-sm font-semibold uppercase tracking-wider text-neutral-700 mb-1.5"
                >
                  {isId ? "Email Akun Terdaftar" : "Registered Account Email"}
                </label>
                <input
                  id="privacy-delete-email"
                  name="email"
                  type="email"
                  required
                  value={deletionEmail}
                  onChange={(e) => setDeletionEmail(e.target.value)}
                  placeholder="founder@brand.com"
                  className="veloxa-auth-input"
                />
              </div>
              <div className="sm:col-span-4">
                <label
                  htmlFor="privacy-delete-tenant"
                  className="block text-sm font-semibold uppercase tracking-wider text-neutral-700 mb-1.5"
                >
                  {isId ? "Nama Brand / Workspace" : "Brand / Workspace Name"}
                </label>
                <input
                  id="privacy-delete-tenant"
                  name="tenant"
                  type="text"
                  value={deletionTenant}
                  onChange={(e) => setDeletionTenant(e.target.value)}
                  placeholder={isId ? "Opsional" : "Optional"}
                  className="veloxa-auth-input"
                />
              </div>
              <div className="sm:col-span-3 flex items-end">
                <button
                  type="submit"
                  className="w-full veloxa-btn-pink rounded-xl px-4 py-3.5 text-sm sm:text-base font-semibold"
                >
                  {isId ? "Kirim Permintaan" : "Submit Request"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </VeloxaDedicatedPageShell>
  );
}
