"use client";

import { useState } from "react";
import VeloxaDedicatedPageShell from "@/components/VeloxaDedicatedPageShell";
import { type VeloxaLocale } from "@/lib/veloxa-i18n";
import { VeloxaLegalDocument, legalContactEmail } from "@/components/VeloxaLegalDocument";
import styles from "@/components/VeloxaDedicatedPageShell.module.css";
import authStyles from "@/components/VeloxaAuthScreen.module.css";

export default function VeloxaPrivacyPolicyPage() {
  const [locale, setLocale] = useState<VeloxaLocale>("id");
  const isId = locale === "id";

  const policies = isId
    ? [
        {
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
          title: "2. Jaminan 0% Pelatihan Model AI Publik (Zero Public AI Training)",
          description:
            "Privasi aset visual dan strategi pemasaran bisnis Anda adalah prioritas utama kami:",
          points: [
            "Foto produk asli, wajah tim/peserta event, logo brand, serta data performa ROAS iklan Anda TIDAK PERNAH digunakan untuk melatih model AI publik atau dibagikan ke pelanggan lain.",
            "Seluruh proses ekstraksi Style DNA dan perancangan komposisi dijalankan di dalam kontainer komputasi ephemeral yang terisolasi per tenant.",
          ],
        },
        {
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
          title: "4. Kepatuhan UU PDP Indonesia, GDPR Eropa, & CCPA",
          description:
            "Sebagai pengguna Veloxa AI di seluruh dunia, Anda memiliki hak penuh atas data Anda:",
          points: [
            "Hak Akses & Portabilitas: Anda dapat mengunduh seluruh riwayat konten, laporan analitik, dan aset Brand Vault Anda kapan saja.",
            "Hak Pencabutan OAuth Instan: Anda dapat memutuskan koneksi Instagram, Facebook, TikTok, dan YouTube dalam 1 klik tanpa menyisakan token aktif.",
            "Hak Penghapusan Data Permanen (Right to Erasure): Anda dapat menghubungi kami untuk meminta penghapusan data akun dan token OAuth.",
          ],
        },
      ]
    : [
        {
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
          title: "2. Strict 0% Public AI Model Training Guarantee",
          description:
            "Your proprietary visual assets and paid marketing performance data remain strictly confidential:",
          points: [
            "Your authentic product photos, event photography, brand logos, and Meta Ads ROAS telemetry are NEVER used to train public AI foundation models or shared with other tenants.",
            "All Style DNA extraction and layout rendering occur inside isolated, tenant-scoped ephemeral compute environments.",
          ],
        },
        {
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
          title: "4. GDPR, CCPA, & Indonesia UU PDP Compliance",
          description:
            "Regardless of your geographic region, Veloxa AI grants you complete sovereignty over your data:",
          points: [
            "Right to Access & Portability: Export your generated creatives, analytics logs, and Brand Vault assets at any time.",
            "Instant OAuth Revocation: Disconnect Instagram, Facebook, TikTok, or YouTube in 1 click, immediately purging stored access tokens.",
            "Right to Permanent Erasure: Contact us to request deletion of your account data and OAuth tokens.",
          ],
        },
      ];

  const sections = policies.map((policy, index) => ({
    id: String(index + 1),
    title: policy.title,
    body: policy.description,
    bullets: policy.points,
  }));
  const subject = isId ? "Permintaan penghapusan data Veloxa" : "Veloxa data deletion request";

  return (
    <VeloxaDedicatedPageShell
      activePage="privacy"
      locale={locale}
      onLocaleChange={setLocale}
      pageTitle={isId ? "Kebijakan Privasi" : "Privacy Policy"}
      pageSubtitle={isId ? "Cara Veloxa AI menangani data akun, aset, dan izin akses Anda." : "How Veloxa AI handles your account data, assets, and access permissions."}
    >
      <VeloxaLegalDocument page="privacy" isId={isId} sections={sections}>
        <section id="data-deletion-request" className={styles.contact} aria-labelledby="data-deletion-title">
          <h2 id="data-deletion-title">{isId ? "Minta penghapusan data" : "Request data deletion"}</h2>
          <p>{isId
            ? <>Kirim permintaan ke <strong>{legalContactEmail}</strong> dari email yang terdaftar di Veloxa. Sertakan nama workspace jika ada.</>
            : <>Send your request to <strong>{legalContactEmail}</strong> from your registered Veloxa email address. Include your workspace name if applicable.</>}</p>
          <a className={`${authStyles.primary} ${styles.action}`} href={`mailto:${legalContactEmail}?subject=${encodeURIComponent(subject)}`}>
            {isId ? "Buka aplikasi email" : "Open email app"}
          </a>
        </section>
      </VeloxaLegalDocument>
    </VeloxaDedicatedPageShell>
  );
}
