'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Gift,
  Lock,
  Mail,
  Rocket,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { VeloxaDedicatedPageShell } from '@/components/VeloxaDedicatedPageShell';
import {
  registerNewVeloxaAccount,
  signInWithGooglePopup,
} from '@/lib/veloxa-auth';

export default function VeloxaRegisterPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [agreedToLegal, setAgreedToLegal] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const syncAriaInvalid = (el: HTMLInputElement) => {
    try {
      el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
    } catch {
      // ignore on older engines
    }
  };

  const handleSimpleRegisterSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || password.length < 6) {
      setErrorMessage(
        'Mohon lengkapi nama lengkap, alamat email aktif, dan password minimal 6 karakter.',
      );
      return;
    }
    if (!agreedToLegal) {
      setErrorMessage('Mohon setujui Terms of Use dan Privacy Policy untuk melanjutkan.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { user } = await registerNewVeloxaAccount({
        name: fullName.trim(),
        email: email.trim(),
        password,
      });

      if (user.isSuperAdmin || user.onboardingCompleted) {
        router.push('/');
      } else {
        router.push('/onboarding');
      }
    } catch {
      setErrorMessage('Terjadi kendala saat membuat akun. Silakan periksa koneksi atau coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleRegister = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const user = await signInWithGooglePopup({ isRegistrationFlow: true });
      if (user.isSuperAdmin || user.onboardingCompleted) {
        router.push('/');
      } else {
        router.push('/onboarding');
      }
    } catch {
      setErrorMessage('Gagal mendaftar dengan Google OAuth.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <VeloxaDedicatedPageShell activePage="register" maxWidthClass="max-w-[1120px]">
      <div
        className="mx-auto grid gap-8 lg:grid-cols-[1.08fr_0.92fr] items-start"
        data-testid="veloxa-dedicated-register-page"
      >
        {/* Left Column: Simple, Clean Sign-Up Form (3 Fields Only + Google OAuth) */}
        <section className="veloxa-luxury-card-pink rounded-[2rem] border border-pink-200 bg-white p-6 sm:p-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/80 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[#D85A88]">
              <Gift className="h-3.5 w-3.5 text-[#EC749B]" />
              Langkah 1 dari 2 · Buat Akun Gratis (Termasuk Free Trial)
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-700">
              <Database className="h-3 w-3" /> Auto-Sync Cloud Firestore
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-900 sm:text-4xl">
            Buat Akun Veloxa AI dalam 15 Detik
          </h1>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-neutral-600">
            Cukup isi nama, email, dan password. Setelah akun dibuat, Anda akan diarahkan ke{' '}
            <strong className="text-neutral-900">Onboarding Bisnis</strong> dan langsung mendapatkan{' '}
            <strong className="text-[#EC749B]">Pilihan Paket Free Trial (Rp0)</strong> untuk mencoba semua fitur!
          </p>

          {/* 1-Click Google OAuth Sign-Up */}
          <div className="mt-6">
            <button
              type="button"
              data-testid="register-google-oauth-btn"
              disabled={isSubmitting}
              onClick={() => void handleGoogleRegister()}
              className="veloxa-luxury-card flex w-full items-center justify-center gap-3 rounded-2xl border border-neutral-200 bg-white px-5 py-3.5 text-sm font-black text-neutral-900 transition hover:border-pink-300 hover:text-[#D85A88] disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4 text-[#EC749B]" />
              <span>Daftar Cepat 1-Klik dengan Google OAuth</span>
            </button>
          </div>

          <div className="my-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200" />
            <span>Atau Daftar dengan Email</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          {errorMessage && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-5 rounded-2xl border border-red-200 bg-red-50/80 p-3.5 text-xs font-bold text-red-700"
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {/* Simple Semantic Sign-Up Form (`autofill-sign-up-form` & `validate-input-after-interaction`) */}
          <form
            method="post"
            action="/register"
            onSubmit={(e) => void handleSimpleRegisterSubmit(e)}
            className="space-y-4"
            data-testid="register-Account-form"
          >
            {/* 1. Single Full Name Input */}
            <div className="veloxa-field-group">
              <label
                htmlFor="register-full-name"
                className="block text-xs font-black uppercase tracking-wider text-neutral-800"
              >
                Nama Lengkap Anda <span className="text-[#EC749B]">*</span>
              </label>
              <div className="relative mt-1.5">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  id="register-full-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  enterKeyHint="next"
                  required
                  minLength={2}
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (e.currentTarget.hasAttribute('aria-invalid')) syncAriaInvalid(e.currentTarget);
                  }}
                  onBlur={(e) => syncAriaInvalid(e.currentTarget)}
                  placeholder="Contoh: Dimas Pratama"
                  data-testid="register-name-input"
                  className="veloxa-auth-input w-full rounded-2xl border border-neutral-200 bg-white py-3.5 pl-10 pr-4 text-sm font-semibold text-neutral-900 shadow-2xs"
                />
              </div>
              <p className="veloxa-error-msg">Mohon masukkan nama lengkap Anda (minimal 2 karakter).</p>
            </div>

            {/* 2. Email Address Input */}
            <div className="veloxa-field-group">
              <label
                htmlFor="register-email"
                className="block text-xs font-black uppercase tracking-wider text-neutral-800"
              >
                Alamat Email Aktif <span className="text-[#EC749B]">*</span>
              </label>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  spellCheck={false}
                  enterKeyHint="next"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (e.currentTarget.hasAttribute('aria-invalid')) syncAriaInvalid(e.currentTarget);
                  }}
                  onBlur={(e) => syncAriaInvalid(e.currentTarget)}
                  placeholder="founder@bisnisanda.id"
                  data-testid="register-email-input"
                  className="veloxa-auth-input w-full rounded-2xl border border-neutral-200 bg-white py-3.5 pl-10 pr-4 text-sm font-semibold text-neutral-900 shadow-2xs"
                />
              </div>
              <p className="veloxa-error-msg">Masukkan format email yang valid (contoh: nama@domain.com).</p>
            </div>

            {/* 3. New Password Input with Visible Rules Above Input */}
            <div className="veloxa-field-group">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="register-new-password"
                  className="block text-xs font-black uppercase tracking-wider text-neutral-800"
                >
                  Buat Password Akun <span className="text-[#EC749B]">*</span>
                </label>
              </div>
              <p id="register-password-rules" className="veloxa-password-rules mt-0.5 text-[11px]">
                Minimal 6 karakter (kombinasi huruf & angka disarankan).
              </p>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  id="register-new-password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  enterKeyHint="done"
                  required
                  minLength={6}
                  aria-describedby="register-password-rules"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (e.currentTarget.hasAttribute('aria-invalid')) syncAriaInvalid(e.currentTarget);
                  }}
                  onBlur={(e) => syncAriaInvalid(e.currentTarget)}
                  placeholder="Minimal 6 karakter"
                  data-testid="register-password-input"
                  className="veloxa-auth-input w-full rounded-2xl border border-neutral-200 bg-white py-3.5 pl-10 pr-24 text-sm font-semibold text-neutral-900 shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[11px] font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  <span>{showPassword ? 'Tutup' : 'Lihat'}</span>
                </button>
              </div>
              <p className="veloxa-error-msg">Password wajib minimal 6 karakter.</p>
            </div>

            {/* Legal Consent Checkbox */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={agreedToLegal}
                onChange={(e) => setAgreedToLegal(e.target.checked)}
                data-testid="register-legal-checkbox"
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-[#EC749B]"
              />
              <span>
                Saya menyetujui{' '}
                <Link href="/terms" className="font-black text-[#D85A88] underline">
                  Terms of Use
                </Link>{' '}
                dan{' '}
                <Link href="/privacy" className="font-black text-[#D85A88] underline">
                  Privacy Policy
                </Link>{' '}
                Veloxa AI.
              </span>
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="register-submit-btn"
              className="veloxa-luxury-card-pink flex w-full items-center justify-center gap-2 rounded-2xl bg-[#EC749B] px-6 py-4 text-sm font-black text-white transition hover:bg-[#DF608A] disabled:opacity-60"
            >
              <Rocket className="h-4 w-4" />
              <span>
                {isSubmitting
                  ? 'Menyimpan ke Firebase Auth & Cloud Firestore...'
                  : 'Buat Akun Gratis & Lanjut ke Onboarding →'}
              </span>
            </button>
          </form>

          <p className="mt-6 text-center text-xs font-semibold text-neutral-600">
            Sudah punya akun Veloxa AI?{' '}
            <Link
              href="/login"
              data-testid="register-goto-login-link"
              className="font-black text-[#D85A88] underline hover:text-[#EC749B]"
            >
              Masuk ke Akun Anda →
            </Link>
          </p>
        </section>

        {/* Right Column: Clear 2-Step Workflow Preview & Free Trial Guarantee */}
        <aside className="space-y-6">
          <div className="veloxa-luxury-card rounded-[2rem] border border-neutral-200 bg-white p-6 sm:p-8 space-y-5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EC749B] px-3 py-1 text-[11px] font-black text-white">
              <Sparkles className="h-3.5 w-3.5" /> ALUR REGISTRASI BARU YANG RINGKAS
            </span>
            <h2 className="text-xl font-black tracking-tight text-neutral-900">
              Daftar Cepat Sekarang, Atur Brand & Pilih Paket Gratis di Langkah Berikutnya
            </h2>

            <div className="space-y-3.5">
              {[
                {
                  step: '1',
                  title: 'Buat Akun (Halaman Ini · 15 Detik)',
                  desc: 'Akun Anda langsung terdaftar di Firebase Authentication sekaligus tersimpan otomatis ke koleksi users/{uid} di Cloud Firestore.',
                  active: true,
                },
                {
                  step: '2',
                  title: 'Onboarding Brand & Pilih Free Trial Rp0',
                  desc: 'Atur nama brand, kategori bisnis, kanal medsos, dan pilih Paket Free Trial (Rp0) untuk mencoba seluruh fitur tanpa biaya.',
                  active: false,
                },
                {
                  step: '3',
                  title: 'Masuk ke Luxury AI Studio Dashboard',
                  desc: 'Nikmati dashboard analitik baru dengan grafik performa ROAS, jadwal otonom 4 sosmed, dan studio produksi konten AI.',
                  active: false,
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className={`flex items-start gap-3.5 rounded-2xl border p-4 ${
                    item.active
                      ? 'border-[#EC749B] bg-[#FFF9FB]'
                      : 'border-neutral-200/90 bg-white'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-xs font-black ${
                      item.active
                        ? 'bg-[#EC749B] text-white'
                        : 'bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    {item.step}
                  </span>
                  <div>
                    <p className="text-xs font-black text-neutral-900">{item.title}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="veloxa-luxury-card rounded-3xl border border-neutral-200/90 bg-white p-6 space-y-3">
            <div className="flex items-center gap-2 text-xs font-black text-neutral-900">
              <ShieldCheck className="h-4 w-4 text-[#EC749B]" />
              <span>Apa Saja yang Bisa Dicoba di Paket Free Trial (Rp0)?</span>
            </div>
            <ul className="space-y-2 text-xs text-neutral-600">
              {[
                '10 Kuota Render Konten AI Gratis (Reels 9:16, Carousel 4:5, & Single Poster)',
                'Dual Brand Vault (Laci 1 Referensi Gaya + Laci 2 Stok Foto Produk Asli)',
                'Self-Healing Quality Gate >=88/100 & AI Voiceover Bahasa Indonesia',
                'Simulasi Penjadwalan Otonom 4 Sosmed & AI Meta Ads Media Buyer',
              ].map((pt) => (
                <li key={pt} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EC749B]" />
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </VeloxaDedicatedPageShell>
  );
}
