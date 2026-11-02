'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MapPin,
  Rocket,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { VeloxaDedicatedPageShell } from '@/components/VeloxaDedicatedPageShell';
import {
  persistPendingRegistrationBrand,
  signInWithEmailPasswordOrRegister,
  signInWithGooglePopup,
} from '@/lib/veloxa-auth';
import { SUBSCRIPTION_PLANS } from '@/lib/veloxa-engine';
import { getPlanLocalizedPrice, type VeloxaLocale } from '@/lib/veloxa-i18n';
import type { BusinessCategory, SubscriptionPlanId } from '@/lib/veloxa-types';

const BUSINESS_CATEGORY_OPTIONS: Array<{
  value: BusinessCategory;
  label: string;
  desc: string;
}> = [
  {
    value: 'running_event',
    label: '🏃 Event Lari, Konser & EO',
    desc: 'Countdown H-30 s.d. Hari-H, Reels rute & medali',
  },
  {
    value: 'cafe_fnb',
    label: '☕ Cafe, Roastery & Restoran',
    desc: 'Reels pour-over, Carousel menu & promo makan siang',
  },
  {
    value: 'clinic_beauty',
    label: '✨ Klinik Estetika & Wellness',
    desc: 'Edukasi dokter, bukti klinis & booking konsultasi WA',
  },
  {
    value: 'fashion_retail',
    label: '👗 Fashion, Retail & E-Commerce',
    desc: 'Lookbook Reels 9:16, katalog Carousel & Meta Ads',
  },
  {
    value: 'custom',
    label: '🚀 Bisnis / UMKM Lainnya',
    desc: 'Kustomisasi penuh Brand Brain untuk segala industri',
  },
];

export default function VeloxaRegisterPage() {
  const router = useRouter();
  const [locale, setLocale] = useState<VeloxaLocale>('id');
  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [businessName, setBusinessName] = useState<string>('');
  const [city, setCity] = useState<string>('Jakarta');
  const [category, setCategory] = useState<BusinessCategory>('cafe_fnb');
  const [planId, setPlanId] = useState<SubscriptionPlanId>('pro_1500k');
  const [agreedToTerms, setAgreedToTerms] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Read optional ?plan= query parameter from URL on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const requestedPlan = params.get('plan') as SubscriptionPlanId | null;
    if (
      requestedPlan &&
      (requestedPlan === 'starter_500k' ||
        requestedPlan === 'growth_1000k' ||
        requestedPlan === 'pro_1500k')
    ) {
      setPlanId(requestedPlan);
    }
  }, []);

  const handleRegisterSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || password.length < 8 || !businessName.trim()) {
      setErrorMessage(
        'Mohon lengkapi nama pemilik, email bisnis, password (minimal 8 karakter), dan nama brand Anda.',
      );
      return;
    }
    if (!agreedToTerms) {
      setErrorMessage('Mohon setujui Terms of Use dan Privacy Policy untuk melanjutkan pendaftaran.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      persistPendingRegistrationBrand({
        businessName: businessName.trim(),
        city: city.trim() || 'Jakarta',
        category,
        planId,
        ownerName: fullName.trim(),
        ownerEmail: email.trim().toLowerCase(),
      });

      await signInWithEmailPasswordOrRegister({
        email: email.trim(),
        password,
        displayName: fullName.trim(),
      });

      router.push('/');
    } catch {
      setErrorMessage('Terjadi kendala saat membuat akun bisnis. Silakan coba kembali.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      if (businessName.trim()) {
        persistPendingRegistrationBrand({
          businessName: businessName.trim(),
          city: city.trim() || 'Jakarta',
          category,
          planId,
          ownerName: fullName.trim() || 'Owner Bisnis Veloxa',
          ownerEmail: email.trim() || 'owner@veloxa.ai',
        });
      }
      await signInWithGooglePopup();
      router.push('/');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <VeloxaDedicatedPageShell activePage="register" onLocaleChange={setLocale}>
      <div
        className="grid items-start gap-10 lg:grid-cols-[1.12fr_0.88fr]"
        data-testid="dedicated-register-page"
      >
        {/* LEFT COLUMN: Dedicated Real Registration & Brand Setup Form */}
        <section className="veloxa-luxury-card rounded-[2rem] border border-neutral-200/90 bg-white p-6 sm:p-10">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/80 px-3.5 py-1 text-xs font-black text-[#D85A88]">
            <Sparkles className="h-3.5 w-3.5 text-[#EC749B]" />
            <span>HALAMAN REGISTRASI BISNIS BARU · SIAP DALAM 60 DETIK</span>
          </div>

          <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-900 sm:text-4xl">
            Daftarkan Bisnis & Aktifkan Studio AI Otonom Anda
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Buat akun pemilik brand, pilih kategori industri, dan biarkan 5 Agen OpenAI menyiapkan Dual Brand Vault serta jadwal konten 4 sosial media Anda.
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

          {/* 1-Click Google OAuth Sign-Up */}
          <div className="mt-6">
            <button
              type="button"
              data-testid="register-page-google-btn"
              disabled={isSubmitting}
              onClick={() => void handleGoogleSignUp()}
              className="veloxa-luxury-card flex w-full items-center justify-center gap-2.5 rounded-2xl border border-neutral-200 bg-white px-5 py-3.5 text-xs font-black text-neutral-900 transition hover:border-pink-200 hover:text-[#D85A88] disabled:opacity-60 sm:text-sm"
            >
              <Sparkles className="h-4 w-4 text-[#EC749B]" />
              <span>Daftar Instan dengan Akun Google (OAuth 1-Klik)</span>
            </button>
          </div>

          <div className="my-6 flex items-center gap-3 text-xs font-bold text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200" />
            <span>ATAU LENGKAPI FORMULIR PENDAFTARAN BISNIS</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          {/* Semantic Sign-Up Form (modern-web-guidance: autofill-sign-up-form, forms, validate-input-after-interaction) */}
          <form
            method="post"
            action="/register"
            onSubmit={(e) => void handleRegisterSubmit(e)}
            className="space-y-6"
            data-testid="dedicated-register-form"
          >
            {/* Step 1: Account Owner Credentials */}
            <fieldset className="space-y-4">
              <legend className="text-sm font-black uppercase tracking-wider text-[#D85A88]">
                1. Data Akun Pemilik Brand / PIC
              </legend>

              {/* Single Full Name Input (allows international Unicode names) */}
              <div className="veloxa-field-group">
                <label
                  htmlFor="register-name"
                  className="block text-xs font-black uppercase tracking-wider text-neutral-800"
                >
                  Nama Lengkap Pemilik / PIC <span className="text-[#EC749B]">*</span>
                </label>
                <span id="register-name-hint" className="mt-0.5 block text-[11px] text-neutral-500">
                  Masukkan nama lengkap Anda dalam satu kolom (mendukung karakter internasional).
                </span>
                <div className="veloxa-input-wrap relative mt-1.5">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    id="register-name"
                    name="full_name"
                    type="text"
                    required
                    maxLength={100}
                    autoComplete="name"
                    enterKeyHint="next"
                    aria-describedby="register-name-hint"
                    aria-errormessage="register-name-error"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Contoh: Nadia Kusuma"
                    data-testid="register-name-input"
                    className="veloxa-auth-input w-full rounded-2xl border border-neutral-300 bg-white pl-10 pr-4 py-3 text-sm font-semibold text-neutral-900 transition focus:border-[#EC749B]"
                  />
                </div>
                <div id="register-name-error" className="veloxa-error-msg">
                  <span aria-hidden="true">❌ </span>Nama lengkap wajib diisi.
                </div>
              </div>

              {/* Work Email Input */}
              <div className="veloxa-field-group">
                <label
                  htmlFor="register-email"
                  className="block text-xs font-black uppercase tracking-wider text-neutral-800"
                >
                  Alamat Email Bisnis <span className="text-[#EC749B]">*</span>
                </label>
                <span id="register-email-hint" className="mt-0.5 block text-[11px] text-neutral-500">
                  Format: owner@namabisnis.com (digunakan untuk login & laporan kampanye).
                </span>
                <div className="veloxa-input-wrap relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    id="register-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="username"
                    spellCheck={false}
                    enterKeyHint="next"
                    aria-describedby="register-email-hint"
                    aria-errormessage="register-email-error"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nadia@kopisenja.id"
                    data-testid="register-email-input"
                    className="veloxa-auth-input w-full rounded-2xl border border-neutral-300 bg-white pl-10 pr-4 py-3 text-sm font-semibold text-neutral-900 transition focus:border-[#EC749B]"
                  />
                </div>
                <div id="register-email-error" className="veloxa-error-msg">
                  <span aria-hidden="true">❌ </span>Masukkan format alamat email bisnis yang valid.
                </div>
              </div>

              {/* New Password Input (autocomplete="new-password" + visible rules above input) */}
              <div className="veloxa-field-group">
                <label
                  htmlFor="register-password"
                  className="block text-xs font-black uppercase tracking-wider text-neutral-800"
                >
                  Buat Password Baru <span className="text-[#EC749B]">*</span>
                </label>
                <ul
                  id="register-password-rules"
                  className="veloxa-password-rules mt-1 list-inside list-disc text-[11px] text-neutral-500"
                >
                  <li>Minimal 8 karakter (boleh menggunakan password generator browser)</li>
                  <li>Disarankan kombinasi huruf & angka untuk keamanan workspace</li>
                </ul>
                <div className="veloxa-input-wrap relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    id="register-password"
                    name="new-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    enterKeyHint="next"
                    aria-describedby="register-password-rules"
                    aria-errormessage="register-password-error"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimal 8 karakter"
                    data-testid="register-password-input"
                    className="veloxa-auth-input w-full rounded-2xl border border-neutral-300 bg-white pl-10 pr-24 py-3 text-sm font-semibold text-neutral-900 transition focus:border-[#EC749B]"
                  />
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    data-testid="register-toggle-password-btn"
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
                <div id="register-password-error" className="veloxa-error-msg">
                  <span aria-hidden="true">❌ </span>Password baru wajib minimal 8 karakter.
                </div>
              </div>
            </fieldset>

            {/* Step 2: Brand Identity & Target Market */}
            <fieldset className="space-y-4 border-t border-neutral-100 pt-5">
              <legend className="text-sm font-black uppercase tracking-wider text-[#D85A88]">
                2. Identitas Brand & Target Pasar
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="veloxa-field-group">
                  <label
                    htmlFor="register-business-name"
                    className="block text-xs font-black uppercase tracking-wider text-neutral-800"
                  >
                    Nama Brand / Acara <span className="text-[#EC749B]">*</span>
                  </label>
                  <div className="veloxa-input-wrap relative mt-1.5">
                    <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <input
                      id="register-business-name"
                      name="organization"
                      type="text"
                      required
                      autoComplete="organization"
                      enterKeyHint="next"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Contoh: Kopi Senja Roastery"
                      data-testid="register-business-input"
                      className="veloxa-auth-input w-full rounded-2xl border border-neutral-300 bg-white pl-10 pr-4 py-3 text-sm font-semibold text-neutral-900 transition focus:border-[#EC749B]"
                    />
                  </div>
                </div>

                <div className="veloxa-field-group">
                  <label
                    htmlFor="register-city"
                    className="block text-xs font-black uppercase tracking-wider text-neutral-800"
                  >
                    Kota / Negara Target <span className="text-[#EC749B]">*</span>
                  </label>
                  <div className="veloxa-input-wrap relative mt-1.5">
                    <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <input
                      id="register-city"
                      name="address-level2"
                      type="text"
                      required
                      autoComplete="address-level2"
                      enterKeyHint="done"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Jakarta / Tokyo / Global"
                      data-testid="register-city-input"
                      className="veloxa-auth-input w-full rounded-2xl border border-neutral-300 bg-white pl-10 pr-4 py-3 text-sm font-semibold text-neutral-900 transition focus:border-[#EC749B]"
                    />
                  </div>
                </div>
              </div>

              {/* 5 Mutually Exclusive Industry Choices -> Radio Group per modern-web-guidance: forms */}
              <div>
                <span className="block text-xs font-black uppercase tracking-wider text-neutral-800">
                  Kategori Industri Bisnis (Pilih 1):
                </span>
                <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                  {BUSINESS_CATEGORY_OPTIONS.map((opt) => {
                    const checked = category === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 text-xs transition ${
                          checked
                            ? 'border-[#EC749B] bg-pink-50/70 ring-1 ring-pink-200'
                            : 'border-neutral-200 bg-white hover:border-pink-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="business_category"
                          value={opt.value}
                          checked={checked}
                          onChange={() => setCategory(opt.value)}
                          className="mt-0.5 h-4 w-4 accent-[#EC749B]"
                        />
                        <div>
                          <span className="block font-black text-neutral-900">{opt.label}</span>
                          <span className="text-[11px] text-neutral-500">{opt.desc}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </fieldset>

            {/* Step 3: Subscription Tier Selection (3 Radio Cards) */}
            <fieldset className="space-y-3 border-t border-neutral-100 pt-5">
              <legend className="text-sm font-black uppercase tracking-wider text-[#D85A88]">
                3. Pilih Paket Langganan Bulanan
              </legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {Object.values(SUBSCRIPTION_PLANS).map((plan) => {
                  const localized = getPlanLocalizedPrice(plan.id, locale);
                  const checked = planId === plan.id;
                  return (
                    <label
                      key={plan.id}
                      data-testid={`register-plan-card-${plan.id}`}
                      className={`flex cursor-pointer flex-col justify-between rounded-2xl border p-3.5 text-xs transition ${
                        checked
                          ? 'border-[#EC749B] bg-pink-50/70 ring-2 ring-pink-200'
                          : 'border-neutral-200 bg-white hover:border-pink-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-black text-neutral-900">{plan.name}</span>
                          <input
                            type="radio"
                            name="subscription_plan"
                            value={plan.id}
                            checked={checked}
                            onChange={() => setPlanId(plan.id)}
                            className="h-4 w-4 accent-[#EC749B]"
                          />
                        </div>
                        <p className="mt-1.5 text-lg font-black text-[#D85A88]">
                          {localized.amountFormatted}
                          <span className="text-[10px] font-semibold text-neutral-500">
                            {localized.periodLabel}
                          </span>
                        </p>
                      </div>
                      <p className="mt-2 text-[11px] font-semibold text-neutral-600">
                        {plan.monthlyPostQuota} post/bln · {plan.allowedChannels.length} Kanal
                        {plan.includesMetaAdsAgent ? ' + AI Meta Ads' : ''}
                      </p>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Legal Consent Checkbox */}
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-3.5 text-xs">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  name="agree_terms"
                  required
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  data-testid="register-terms-checkbox"
                  className="mt-0.5 h-4 w-4 accent-[#EC749B]"
                />
                <span className="leading-relaxed text-neutral-700">
                  Saya menyetujui{' '}
                  <Link href="/terms" className="font-black text-[#D85A88] underline">
                    Terms of Use (Syarat Penggunaan)
                  </Link>{' '}
                  dan{' '}
                  <Link href="/privacy" className="font-black text-[#D85A88] underline">
                    Privacy Policy (Kebijakan Privasi)
                  </Link>{' '}
                  Veloxa AI, termasuk otorisasi publikasi konten otonom yang dapat dikontrol kapan saja.
                </span>
              </label>
            </div>

            {/* Submit Button with Clear Recognizable Label */}
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="register-submit-btn"
              className="veloxa-luxury-card-pink flex w-full items-center justify-center gap-2 rounded-2xl bg-[#EC749B] px-6 py-4 text-sm font-black text-white transition hover:bg-[#DF608A] disabled:opacity-60"
            >
              <Rocket className="h-4 w-4 shrink-0" />
              <span>
                {isSubmitting
                  ? 'Menyiapkan Workspace Brand Baru Anda...'
                  : 'Buat Akun Bisnis & Buka Studio Veloxa AI'}
              </span>
            </button>
          </form>

          {/* Link to Login Page */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-5 text-xs">
            <span className="text-neutral-600">Sudah memiliki akun bisnis Veloxa AI?</span>
            <Link
              href="/login"
              data-testid="register-to-login-link"
              className="font-black text-[#D85A88] hover:underline"
            >
              Masuk di Halaman Login →
            </Link>
          </div>
        </section>

        {/* RIGHT COLUMN: Onboarding Benefits & Zero-Risk Guarantee */}
        <aside className="space-y-6">
          <div className="veloxa-luxury-card-pink rounded-[2rem] border border-pink-200 bg-white p-6 sm:p-8 ring-1 ring-pink-100">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EC749B] px-3 py-1 text-[11px] font-black text-white">
              ✓ APA YANG LANGSUNG ANDA DAPATKAN
            </span>
            <h2 className="mt-4 text-xl font-black text-neutral-900 sm:text-2xl">
              Studio AI Anda Langsung Terisi Draf Reels, Carousel, & Rencana Meta Ads
            </h2>
            <ul className="mt-4 space-y-3 text-xs text-neutral-700">
              {[
                'Laci 1 (Style Reference Vault) & Laci 2 (Stok Foto Produk Asli) siap dipakai.',
                'Draf awal Reels 9:16, Carousel 4:5 (4 slide), dan Poster Feed langsung ter-generate sesuai nama brand Anda.',
                'Koneksi OAuth 1-Klik ke Instagram, Facebook Page, TikTok, dan YouTube Shorts tanpa ribet membuat API Key sendiri.',
                'Bebas pilih Mode Co-Pilot (tinjau H-1 sebelum tayang) atau 100% Full Otonom.',
                'Pembayaran via Web (QRIS / Virtual Account / Kartu Global) bebas potongan komisi 30% App Store / Play Store.',
              ].map((benefit) => (
                <li key={benefit} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#EC749B]" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="veloxa-luxury-card rounded-3xl border border-neutral-200/90 bg-white p-6 text-xs">
            <div className="flex items-center gap-2 font-black text-neutral-900">
              <ShieldCheck className="h-4 w-4 text-[#EC749B]" />
              <span>100% Kepemilikan Hak Cipta & Pagar Budget</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-neutral-600">
              Seluruh foto produk asli yang Anda unggah maupun hasil render Reels/Carousel adalah 100% hak milik bisnis Anda dan tidak pernah dibagikan ke tenant lain.
            </p>
          </div>
        </aside>
      </div>
    </VeloxaDedicatedPageShell>
  );
}
