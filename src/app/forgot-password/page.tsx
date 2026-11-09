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
    try {
      const res = await sendVeloxaPasswordReset(cleanEmail);
      setResetResult({ referenceCode: res.resetReferenceCode, deliveredViaFirebase: res.deliveredViaFirebase, sentToEmail: cleanEmail });
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : (isId ? 'Tautan reset belum dapat dikirim. Silakan coba lagi.' : 'Unable to send a reset link. Please try again.'));
    } finally { setBusy(false); }
  }

  return (
    <VeloxaDedicatedPageShell
      activePage="forgot-password"
      locale={locale}
      onLocaleChange={setLocale}
      pageBadge={
        isId
          ? "Pemulihan akun"
          : "Account recovery"
      }
      pageTitle={
        isId
          ? "Lupa password?"
          : "Forgot your password?"
      }
      pageSubtitle={
        isId
          ? "Masukkan email terdaftar untuk menerima tautan pemulihan."
          : "Enter your account email to receive a password reset link."
      }
      maxWidthClass="max-w-[1040px]"
    >
      <div className="mx-auto w-full max-w-[560px]">
        {/* Left Column: Dedicated Password Recovery Form */}
        <div className="veloxa-luxury-card-pink rounded-xl p-6 sm:p-9 bg-white">
          <div className="flex items-center justify-between gap-3 pb-6 mb-6 border-b border-neutral-100">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF0F5] border border-[#FBCFE0] px-3 py-1 text-xs font-medium text-[#a92e5d]">
                🔐 {isId ? "Halaman Khusus Lupa Password" : "Dedicated Password Reset Page"}
              </span>
              <h2 className="mt-2 text-xl sm:text-2xl font-semibold text-neutral-900">
                {isId ? "Kirim Tautan Reset Password" : "Send Password Reset Link"}
              </h2>
            </div>
            <div className="hidden sm:flex h-12 w-12 items-center justify-center rounded-xl bg-[#FFF0F5] border border-[#FBCFE0] text-xl font-semibold text-[#a92e5d]">
              ↺
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-6 rounded-xl border border-[#DC2626]/30 bg-[#FEF2F2] p-4 text-sm font-semibold text-[#DC2626]"
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {resetResult ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border-2 border-[#EC749B] bg-[#FFF9FB] p-6 space-y-4"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#bd416e] px-3.5 py-1 text-xs font-semibold text-white">
                  ✓ {isId ? "Tautan Pemulihan Terkirim" : "Recovery Link Dispatched"}
                </span>

              </div>

              <h3 className="text-lg font-semibold text-neutral-900">
                {isId
                  ? `Jika akun terdaftar, instruksi reset akan dikirim ke ${resetResult.sentToEmail}`
                  : `If an account exists, reset instructions will be sent to ${resetResult.sentToEmail}`}
              </h3>

              <p className="text-sm sm:text-base text-neutral-600 leading-relaxed">
                {isId
                  ? "Silakan periksa kotak masuk (Inbox) atau folder Spam/Promosi email Anda dalam 1–3 menit ke depan. Klik tautan terenkripsi di dalam email untuk menetapkan kata sandi baru Anda."
                  : "Please check your email inbox or Spam/Promotions folder within the next 1–3 minutes. Click the encrypted link inside the email to set your new password."}
              </p>

              <div className="rounded-xl bg-white border border-neutral-200 p-4 space-y-2 text-sm text-neutral-700">
                <div className="font-medium text-neutral-900">
                  {isId ? "Detail Pengiriman Keamanan:" : "Security Dispatch Details:"}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">{isId ? "Email Tujuan:" : "Target Email:"}</span>
                  <span className="font-medium text-neutral-900">{resetResult.sentToEmail}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">{isId ? "Masa Berlaku Tautan:" : "Link Expiration:"}</span>
                  <span className="font-semibold text-neutral-900">{isId ? "Mengikuti ketentuan Firebase" : "Subject to Firebase policy"}</span>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-3">
                <Link
                  href="/login"
                  className="veloxa-btn-pink rounded-xl px-6 py-3 text-sm sm:text-base font-semibold inline-flex items-center gap-2"
                >
                  ← {isId ? "Kembali ke Halaman Login" : "Return to Sign In Page"}
                </Link>
                <button
                  type="button"
                  onClick={() => setResetResult(null)}
                  className="rounded-xl border border-neutral-200 bg-white px-5 py-3 text-sm sm:text-base font-medium text-neutral-700 hover:border-[#EC749B] hover:text-[#a92e5d] transition"
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
                  className="block text-sm font-semibold uppercase tracking-wider text-neutral-700 mb-2"
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
                <p id="forgot-email-help" className="mt-2 text-sm text-neutral-500">
                  {isId
                    ? "Pastikan email sesuai dengan akun pemilik brand atau anggota tim workspace Anda."
                    : "Make sure this matches your registered brand owner or workspace member email."}
                </p>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full veloxa-btn-pink rounded-xl px-6 py-4 text-base sm:text-base font-semibold shadow-md transition disabled:opacity-50"
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
          <div className="mt-7 pt-6 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-3 text-sm sm:text-base">
            <Link
              href="/login"
              className="font-semibold text-neutral-700 hover:text-[#a92e5d] transition inline-flex items-center gap-1.5"
            >
              ← {isId ? "Sudah ingat password? Masuk di sini" : "Remembered your password? Sign in here"}
            </Link>
            <Link
              href="/register"
              className="font-semibold text-[#a92e5d] hover:underline"
            >
              {isId ? "Buat Akun Baru →" : "Create New Account →"}
            </Link>
          </div>
        </div>

      </div>
    </VeloxaDedicatedPageShell>
  );
}
