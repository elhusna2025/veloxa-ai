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
  const [agreedToLegal, setAgreedToLegal] = useState<boolean>(false);
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
    if (!agreedToLegal) { setErrorMessage('Mohon setujui Ketentuan Layanan dan Kebijakan Privasi untuk melanjutkan.'); return; }
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
        className="mx-auto w-full max-w-[520px]"
        data-testid="veloxa-dedicated-register-page"
      >
        {/* Left Column: Simple, Clean Sign-Up Form (3 Fields Only + Google OAuth) */}
        <section className="veloxa-luxury-card-pink rounded-xl border border-pink-200 bg-white p-6 sm:p-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#a92e5d]">
              <Gift className="h-3.5 w-3.5 text-[#a92e5d]" />
              Buat akun baru
            </span>

          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
            Buat akun Veloxa
          </h1>
          <p className="mt-2 text-sm sm:text-base leading-relaxed text-neutral-600">
            Satu tempat untuk membuat konten dan mengelola akun bisnis Anda.
          </p>

            {/* Legal Consent Checkbox */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={agreedToLegal}
                onChange={(e) => setAgreedToLegal(e.target.checked)}
                data-testid="register-legal-checkbox"
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-[#EC749B]"
              />
              <span>
                Saya menyetujui{' '}
                <Link href="/terms" className="font-semibold text-[#a92e5d] underline">
                  Terms of Use
                </Link>{' '}
                dan{' '}
                <Link href="/privacy" className="font-semibold text-[#a92e5d] underline">
                  Privacy Policy
                </Link>{' '}
                Veloxa AI.
              </span>
            </label>

          {/* 1-Click Google OAuth Sign-Up */}
          <div className="mt-6">
            <button
              type="button"
              data-testid="register-google-oauth-btn"
              disabled={isSubmitting}
              onClick={() => void handleGoogleRegister()}
              className="veloxa-luxury-card flex w-full items-center justify-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-3.5 text-base font-semibold text-neutral-900 transition hover:border-pink-300 hover:text-[#a92e5d] disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4 text-[#a92e5d]" />
              <span>Lanjutkan dengan Google</span>
            </button>
          </div>

          <div className="my-5 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200" />
            <span>Atau Daftar dengan Email</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          {errorMessage && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-5 rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-sm font-medium text-red-700"
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
                className="block text-sm font-semibold uppercase tracking-wider text-neutral-800"
              >
                Nama Lengkap Anda <span className="text-[#a92e5d]">*</span>
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
                  className="veloxa-auth-input w-full rounded-xl border border-neutral-200 bg-white py-3.5 pl-10 pr-4 text-base font-semibold text-neutral-900 shadow-2xs"
                />
              </div>
              <p className="veloxa-error-msg">Mohon masukkan nama lengkap Anda (minimal 2 karakter).</p>
            </div>

            {/* 2. Email Address Input */}
            <div className="veloxa-field-group">
              <label
                htmlFor="register-email"
                className="block text-sm font-semibold uppercase tracking-wider text-neutral-800"
              >
                Alamat Email Aktif <span className="text-[#a92e5d]">*</span>
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
                  className="veloxa-auth-input w-full rounded-xl border border-neutral-200 bg-white py-3.5 pl-10 pr-4 text-base font-semibold text-neutral-900 shadow-2xs"
                />
              </div>
              <p className="veloxa-error-msg">Masukkan format email yang valid (contoh: nama@domain.com).</p>
            </div>

            {/* 3. New Password Input with Visible Rules Above Input */}
            <div className="veloxa-field-group">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="register-new-password"
                  className="block text-sm font-semibold uppercase tracking-wider text-neutral-800"
                >
                  Buat Password Akun <span className="text-[#a92e5d]">*</span>
                </label>
              </div>
              <p id="register-password-rules" className="veloxa-password-rules mt-0.5 text-xs">
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
                  className="veloxa-auth-input w-full rounded-xl border border-neutral-200 bg-white py-3.5 pl-10 pr-24 text-base font-semibold text-neutral-900 shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-pink-200 hover:text-[#a92e5d]"
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  <span>{showPassword ? 'Tutup' : 'Lihat'}</span>
                </button>
              </div>
              <p className="veloxa-error-msg">Password wajib minimal 6 karakter.</p>
            </div>



            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="register-submit-btn"
              className="veloxa-luxury-card-pink flex w-full items-center justify-center gap-2 rounded-xl bg-[#bd416e] px-6 py-4 text-base font-semibold text-white transition hover:bg-[#a92e5d] disabled:opacity-60"
            >
              <Rocket className="h-4 w-4" />
              <span>
                {isSubmitting
                  ? 'Menyimpan ke Firebase Auth & Cloud Firestore...'
                  : 'Buat akun'}
              </span>
            </button>
          </form>

          <p className="mt-6 text-center text-sm font-semibold text-neutral-600">
            Sudah punya akun Veloxa AI?{' '}
            <Link
              href="/login"
              data-testid="register-goto-login-link"
              className="font-semibold text-[#a92e5d] underline hover:text-[#a92e5d]"
            >
              Masuk ke Akun Anda →
            </Link>
          </p>
        </section>

        {/* Right Column: Clear 2-Step Workflow Preview & Free Trial Guarantee */}

      </div>
    </VeloxaDedicatedPageShell>
  );
}
