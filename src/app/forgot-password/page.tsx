"use client";

import React, { useState } from "react";
import Link from "next/link";
import VeloxaDedicatedPageShell from "@/components/VeloxaDedicatedPageShell";
import { type VeloxaLocale } from "@/lib/veloxa-i18n";
import { sendVeloxaPasswordReset } from "@/lib/veloxa-auth";

export default function VeloxaForgotPasswordPage() {
  const [locale, setLocale] = useState<VeloxaLocale>("id");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{
    referenceCode: string;
    deliveredViaFirebase: boolean;
    sentToEmail: string;
  } | null>(null);

  const isId = locale === "id";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErrorMsg(
        isId
          ? "Masukkan alamat email bisnis yang valid (contoh: founder@bisnisanda.id)."
          : "Please enter a valid business email address (e.g. founder@yourbrand.com)."
      );
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    const res = await sendVeloxaPasswordReset(cleanEmail);
    setBusy(false);

    if (!res.ok) {
      setErrorMsg("Failed to send password reset link.");
      return;
    }

    setResetResult({
      referenceCode: res.resetReferenceCode,
      deliveredViaFirebase: res.deliveredViaFirebase,
      sentToEmail: cleanEmail,
    });
  }

  return (
    <VeloxaDedicatedPageShell
      activePage="forgot-password"
      locale={locale}
      onLocaleChange={setLocale}
      pageBadge={
        isId
          ? "PEMULIHAN AKSES AKUN · KEAMANAN ENTERPRISE"
          : "ACCOUNT ACCESS RECOVERY · ENTERPRISE SECURITY"
      }
      pageTitle={
        isId
          ? "Pulihkan Kata Sandi Workspace Veloxa AI"
          : "Reset Your Veloxa AI Workspace Password"
      }
      pageSubtitle={
        isId
          ? "Masukkan email yang terdaftar pada akun bisnis atau agensi Anda. Kami akan mengirimkan tautan pemulihan terenkripsi beserta kode referensi keamanan."
          : "Enter the email address associated with your brand or agency workspace. We will send an encrypted password reset link with a security reference code."
      }
      maxWidthClass="max-w-[1040px]"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
        {/* Left Column: Dedicated Password Recovery Form */}
        <div className="lg:col-span-7 veloxa-luxury-card-pink rounded-[28px] p-6 sm:p-9 bg-white">
          <div className="flex items-center justify-between gap-3 pb-6 mb-6 border-b border-neutral-100">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF0F5] border border-[#FBCFE0] px-3 py-1 text-[11px] font-bold text-[#EC749B]">
                🔐 {isId ? "Halaman Khusus Lupa Password" : "Dedicated Password Reset Page"}
              </span>
              <h2 className="mt-2 text-xl sm:text-2xl font-extrabold text-neutral-900">
                {isId ? "Kirim Tautan Reset Password" : "Send Password Reset Link"}
              </h2>
            </div>
            <div className="hidden sm:flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF0F5] border border-[#FBCFE0] text-xl font-black text-[#EC749B]">
              ↺
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-6 rounded-2xl border border-[#DC2626]/30 bg-[#FEF2F2] p-4 text-xs font-semibold text-[#DC2626]"
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {resetResult ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-2xl border-2 border-[#EC749B] bg-[#FFF9FB] p-6 space-y-4"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EC749B] px-3.5 py-1 text-[11px] font-extrabold text-white">
                  ✓ {isId ? "Tautan Pemulihan Terkirim" : "Recovery Link Dispatched"}
                </span>
                <span className="rounded-xl bg-white border border-[#FBCFE0] px-3 py-1 font-mono text-xs font-extrabold text-neutral-900">
                  REF: {resetResult.referenceCode}
                </span>
              </div>

              <h3 className="text-lg font-extrabold text-neutral-900">
                {isId
                  ? `Instruksi reset password telah dikirim ke ${resetResult.sentToEmail}`
                  : `Password reset instructions sent to ${resetResult.sentToEmail}`}
              </h3>

              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                {isId
                  ? "Silakan periksa kotak masuk (Inbox) atau folder Spam/Promosi email Anda dalam 1–3 menit ke depan. Klik tautan terenkripsi di dalam email untuk menetapkan kata sandi baru Anda."
                  : "Please check your email inbox or Spam/Promotions folder within the next 1–3 minutes. Click the encrypted link inside the email to set your new password."}
              </p>

              <div className="rounded-xl bg-white border border-neutral-200 p-4 space-y-2 text-xs text-neutral-700">
                <div className="font-bold text-neutral-900">
                  {isId ? "Detail Pengiriman Keamanan:" : "Security Dispatch Details:"}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">{isId ? "Email Tujuan:" : "Target Email:"}</span>
                  <span className="font-bold text-neutral-900">{resetResult.sentToEmail}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">{isId ? "Kode Referensi:" : "Reference Code:"}</span>
                  <span className="font-mono font-bold text-[#EC749B]">{resetResult.referenceCode}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">{isId ? "Masa Berlaku Tautan:" : "Link Expiration:"}</span>
                  <span className="font-semibold text-neutral-900">60 {isId ? "Menit" : "Minutes"}</span>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-3">
                <Link
                  href="/login"
                  className="veloxa-btn-pink rounded-2xl px-6 py-3 text-xs sm:text-sm font-extrabold inline-flex items-center gap-2"
                >
                  ← {isId ? "Kembali ke Halaman Login" : "Return to Sign In Page"}
                </Link>
                <button
                  type="button"
                  onClick={() => setResetResult(null)}
                  className="rounded-2xl border border-neutral-200 bg-white px-5 py-3 text-xs sm:text-sm font-bold text-neutral-700 hover:border-[#EC749B] hover:text-[#EC749B] transition"
                >
                  {isId ? "Kirim Ulang ke Email Lain" : "Send to Another Email"}
                </button>
              </div>
            </div>
          ) : (
            <form method="post" onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="forgot-email"
                  className="block text-xs font-extrabold uppercase tracking-wider text-neutral-700 mb-2"
                >
                  {isId ? "Alamat Email Akun Veloxa AI" : "Veloxa AI Account Email Address"}
                </label>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={isId ? "founder@bisnisanda.id" : "founder@yourbrand.com"}
                  className="veloxa-auth-input"
                  aria-describedby="forgot-email-help"
                />
                <p id="forgot-email-help" className="mt-2 text-xs text-neutral-500">
                  {isId
                    ? "Pastikan email sesuai dengan akun pemilik brand atau anggota tim workspace Anda."
                    : "Make sure this matches your registered brand owner or workspace member email."}
                </p>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full veloxa-btn-pink rounded-2xl px-6 py-4 text-sm sm:text-base font-extrabold shadow-md transition disabled:opacity-50"
              >
                {busy
                  ? isId
                    ? "Mengirim Tautan Pemulihan..."
                    : "Sending Recovery Link..."
                  : isId
                    ? "Kirim Tautan Reset Password →"
                    : "Send Password Reset Link →"}
              </button>
            </form>
          )}

          {/* Navigation links to Login & Register */}
          <div className="mt-7 pt-6 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
            <Link
              href="/login"
              className="font-extrabold text-neutral-700 hover:text-[#EC749B] transition inline-flex items-center gap-1.5"
            >
              ← {isId ? "Sudah ingat password? Masuk di sini" : "Remembered your password? Sign in here"}
            </Link>
            <Link
              href="/register"
              className="font-extrabold text-[#EC749B] hover:underline"
            >
              {isId ? "Buat Akun Baru →" : "Create New Account →"}
            </Link>
          </div>
        </div>

        {/* Right Column: Security & Account Recovery Assurance */}
        <div className="lg:col-span-5 space-y-5">
          <div className="veloxa-luxury-card rounded-[26px] p-6 sm:p-7 bg-white space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#FFF0F5] border border-[#FBCFE0] px-3 py-1 text-[11px] font-bold text-[#EC749B]">
              🛡️ {isId ? "PROTEKSI KEAMANAN AKUN" : "ACCOUNT SECURITY PROTECTION"}
            </div>
            <h3 className="text-lg font-extrabold text-neutral-900">
              {isId
                ? "Apa yang Terjadi Saat Anda Mereset Password?"
                : "What Happens When You Reset Your Password?"}
            </h3>
            <ul className="space-y-3 text-xs sm:text-sm text-neutral-600 leading-relaxed">
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF0F5] text-[11px] font-black text-[#EC749B]">
                  1
                </span>
                <span>
                  <strong className="text-neutral-900">
                    {isId ? "Koneksi OAuth 4 Sosmed Tetap Aman:" : "4-Channel OAuth Remains Intact:"}
                  </strong>{" "}
                  {isId
                    ? "Mereset password akun Veloxa AI tidak memutus koneksi Instagram, Facebook Page, TikTok, atau YouTube Shorts yang sudah terhubung."
                    : "Resetting your Veloxa AI password does not disconnect your linked Instagram, Facebook Page, TikTok, or YouTube Shorts accounts."}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF0F5] text-[11px] font-black text-[#EC749B]">
                  2
                </span>
                <span>
                  <strong className="text-neutral-900">
                    {isId ? "Jadwal Autopilot & Iklan Tetap Berjalan:" : "Autopilot & Ads Continue Uninterrupted:"}
                  </strong>{" "}
                  {isId
                    ? "Antrean posting harian dan kampanye AI Meta Ads Anda tetap berjalan normal selama proses pemulihan."
                    : "Your scheduled daily posts and active AI Meta Ads campaigns continue running normally during recovery."}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF0F5] text-[11px] font-black text-[#EC749B]">
                  3
                </span>
                <span>
                  <strong className="text-neutral-900">
                    {isId ? "Login Cepat dengan Google:" : "Instant Google Sign-In Alternative:"}
                  </strong>{" "}
                  {isId
                    ? "Jika email bisnis Anda menggunakan Google Workspace atau Gmail, Anda juga bisa langsung masuk melalui tombol Google OAuth di halaman Login tanpa perlu password."
                    : "If your business email uses Google Workspace or Gmail, you can also sign in directly via Google OAuth on the Sign In page without needing a password."}
                </span>
              </li>
            </ul>
          </div>

          <div className="veloxa-luxury-card rounded-[24px] p-5 bg-white flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-extrabold text-neutral-900">
                {isId ? "Butuh Bantuan Tim Enterprise?" : "Need Enterprise Support?"}
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                security@veloxa.ai · 24/7 Priority Desk
              </div>
            </div>
            <Link
              href="/privacy"
              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 hover:border-[#EC749B] hover:text-[#EC749B] transition shrink-0"
            >
              {isId ? "Kebijakan Privasi" : "Privacy Policy"}
            </Link>
          </div>
        </div>
      </div>
    </VeloxaDedicatedPageShell>
  );
}
