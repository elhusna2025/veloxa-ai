'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { VeloxaDedicatedPageShell } from '@/components/VeloxaDedicatedPageShell';
import {
  SUPER_ADMIN_EMAIL,
  signInWithEmailPasswordOrRegister,
  signInWithGooglePopup,
} from '@/lib/veloxa-auth';

export default function VeloxaLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Mohon masukkan alamat email bisnis dan password Anda.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const user = await signInWithEmailPasswordOrRegister({
        email: email.trim(),
        password,
      });
      if (!user.isSuperAdmin && user.onboardingCompleted === false) {
        router.push('/onboarding');
      } else {
        router.push('/');
      }
    } catch {
      setErrorMessage('Gagal memverifikasi kredensial. Silakan periksa kembali email dan password Anda.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const user = await signInWithGooglePopup();
      if (!user.isSuperAdmin && user.onboardingCompleted === false) {
        router.push('/onboarding');
      } else {
        router.push('/');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Login Google belum berhasil.');
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <VeloxaDedicatedPageShell activePage="login">
      <div
        className="grid items-start gap-10 lg:grid-cols-[1.02fr_0.98fr]"
        data-testid="dedicated-login-page"
      >
        {/* LEFT COLUMN: Dedicated Real Sign-In Form Card */}
        <section className="veloxa-luxury-card rounded-[2rem] border border-neutral-200/90 bg-white p-6 sm:p-10">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/80 px-3.5 py-1 text-xs font-black text-[#D85A88]">
            <Lock className="h-3.5 w-3.5 text-[#EC749B]" />
            <span>HALAMAN LOGIN RESMI · MULTI-TENANT WORKSPACE</span>
          </div>

          <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-900 sm:text-4xl">
            Masuk ke Workspace Veloxa AI
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Kelola jadwal produksi Reels 9:16, Carousel 4:5, Dual Brand Vault, dan AI Media Buyer Meta Ads bisnis Anda dalam satu studio otonom.
          </p>

          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs font-bold text-red-700"
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {/* 1-Click Google OAuth Sign-In */}
          <div className="mt-6">
            <button
              type="button"
              data-testid="login-page-google-btn"
              disabled={isSubmitting}
              onClick={() => void handleGoogleLogin()}
              className="veloxa-luxury-card flex w-full items-center justify-center gap-2.5 rounded-2xl border border-neutral-200 bg-white px-5 py-3.5 text-xs font-black text-neutral-900 transition hover:border-pink-200 hover:text-[#D85A88] disabled:opacity-60 sm:text-sm"
            >
              <Sparkles className="h-4 w-4 text-[#EC749B]" />
              <span>Lanjutkan dengan Akun Google (OAuth 1-Klik)</span>
            </button>
          </div>

          <div className="my-6 flex items-center gap-3 text-xs font-bold text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200" />
            <span>ATAU MASUK DENGAN EMAIL BISNIS</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          {/* Semantic HTML Sign-In Form (modern-web-guidance: autofill-sign-in-form & validate-input-after-interaction) */}
          <form
            method="post"
            action="/login"
            onSubmit={(e) => void handleLoginSubmit(e)}
            className="space-y-5"
            data-testid="dedicated-login-form"
          >
            {/* Email Field */}
            <div className="veloxa-field-group">
              <label
                htmlFor="login-email"
                className="block text-xs font-black uppercase tracking-wider text-neutral-800"
              >
                Alamat Email Bisnis <span className="text-[#EC749B]">*</span>
              </label>
              <span id="login-email-hint" className="mt-0.5 block text-[11px] text-neutral-500">
                Gunakan alamat email yang terdaftar pada akun Anda.
              </span>
              <div className="veloxa-input-wrap relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  spellCheck={false}
                  enterKeyHint="next"
                  aria-describedby="login-email-hint"
                  aria-errormessage="login-email-error"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@nusantararun.id"
                  data-testid="login-email-input"
                  className="veloxa-auth-input w-full rounded-2xl border border-neutral-300 bg-white pl-10 pr-4 py-3 text-sm font-semibold text-neutral-900 transition focus:border-[#EC749B]"
                />
              </div>
              <div id="login-email-error" className="veloxa-error-msg">
                <span aria-hidden="true">❌ </span>Masukkan format alamat email yang valid (contoh: nama@bisnis.com).
              </div>
            </div>

            {/* Password Field with Show/Hide Toggle & Forgot Password Link */}
            <div className="veloxa-field-group">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-black uppercase tracking-wider text-neutral-800"
                >
                  Password Akun <span className="text-[#EC749B]">*</span>
                </label>
                <Link
                  href="/forgot-password"
                  data-testid="login-to-forgot-password-link"
                  className="inline-flex items-center gap-1 text-xs font-black text-[#D85A88] hover:underline"
                >
                  <KeyRound className="h-3.5 w-3.5 text-[#EC749B]" />
                  <span>Lupa Password?</span>
                </Link>
              </div>
              <span id="login-password-hint" className="mt-0.5 block text-[11px] text-neutral-500">
                Minimal 6 karakter. Anda dapat menampilkan password untuk memeriksa ketikan.
              </span>
              <div className="veloxa-input-wrap relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="current-password"
                  enterKeyHint="done"
                  aria-describedby="login-password-hint"
                  aria-errormessage="login-password-error"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password akun Anda"
                  data-testid="login-password-input"
                  className="veloxa-auth-input w-full rounded-2xl border border-neutral-300 bg-white pl-10 pr-24 py-3 text-sm font-semibold text-neutral-900 transition focus:border-[#EC749B]"
                />
                <button
                  type="button"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  onClick={() => setShowPassword((prev) => !prev)}
                  data-testid="login-toggle-password-btn"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[11px] font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                >
                  {showPassword ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5 text-[#EC749B]" />
                      <span>Tutup</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5 text-neutral-500" />
                      <span>Lihat</span>
                    </>
                  )}
                </button>
              </div>
              <div id="login-password-error" className="veloxa-error-msg">
                <span aria-hidden="true">❌ </span>Password wajib diisi (minimal 6 karakter).
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="login-submit-btn"
              className="veloxa-luxury-card-pink flex w-full items-center justify-center gap-2 rounded-2xl bg-[#EC749B] px-6 py-4 text-sm font-black text-white transition hover:bg-[#DF608A] disabled:opacity-60"
            >
              <Rocket className="h-4 w-4 shrink-0" />
              <span>{isSubmitting ? 'Memverifikasi Sesi Workspace...' : 'Masuk ke Workspace Veloxa AI'}</span>
            </button>
          </form>


        </section>

        {/* RIGHT COLUMN: Luxury Brand & Security Assurance Showcase */}
        <aside className="space-y-6">
          <div className="veloxa-luxury-card-pink rounded-[2rem] border border-pink-200 bg-white p-6 sm:p-8 ring-1 ring-pink-100">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EC749B] px-3 py-1 text-[11px] font-black text-white">
              <TrendingUp className="h-3.5 w-3.5" />
              STATUS KONEKSI CLOUD & 5 AGEN OPENAI
            </span>
            <h2 className="mt-4 text-xl font-black text-neutral-900 sm:text-2xl">
              Satu Akun untuk Mengotomatiskan 4 Sosial Media & Meta Ads 24/7
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600 sm:text-sm">
              Begitu Anda masuk, Brand Brain AI langsung memuat profil bisnis, laci referensi gaya visual, stok foto produk asli, serta metrik kampanye Meta Ads Anda secara instan (0ms Local-First Cache).
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                {
                  title: 'OAuth Resmi 4 Kanal',
                  desc: 'Instagram Reels, Facebook Page, TikTok Video/Photo, & YouTube Shorts.',
                },
                {
                  title: 'Dual Brand Vault AI',
                  desc: '100% memakai foto produk/event asli bisnis Anda tanpa halusinasi.',
                },
                {
                  title: 'Quality Gate >=88/100',
                  desc: 'Self-healing koreksi otomatis sebelum konten tayang ke publik.',
                },
                {
                  title: 'AI Media Buyer 24/7',
                  desc: 'Auto-pause iklan mahal & alihkan 100% budget ke iklan pemenang.',
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-neutral-200/90 bg-white p-3.5 text-xs shadow-2xs"
                >
                  <div className="flex items-center gap-1.5 font-black text-neutral-900">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#EC749B]" />
                    <span>{item.title}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="veloxa-luxury-card rounded-3xl border border-neutral-200/90 bg-white p-6 text-xs">
            <div className="flex items-center gap-2 font-black text-neutral-900">
              <ShieldCheck className="h-4 w-4 text-[#EC749B]" />
              <span>Keamanan Sesi & Kepatuhan Privasi Global</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-neutral-600">
              Kredensial login Anda dilindungi oleh enkripsi TLS 1.3 dan isolasi tenant Cloud Firestore. Dengan masuk ke akun Anda, Anda menyetujui{' '}
              <Link href="/terms" className="font-black text-[#D85A88] underline">
                Terms of Use
              </Link>{' '}
              dan{' '}
              <Link href="/privacy" className="font-black text-[#D85A88] underline">
                Privacy Policy
              </Link>{' '}
              Veloxa AI.
            </p>
          </div>
        </aside>
      </div>
    </VeloxaDedicatedPageShell>
  );
}
