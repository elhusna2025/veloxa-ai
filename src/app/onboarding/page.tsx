'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Database,
  Gift,
  MapPin,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wand2,
} from 'lucide-react';
import { VeloxaDedicatedPageShell } from '@/components/VeloxaDedicatedPageShell';
import {
  completeVeloxaOnboarding,
  getInitialAuthenticatedUser,
  subscribeToFirebaseAuthChanges,
} from '@/lib/veloxa-auth';
import { SUBSCRIPTION_PLANS } from '@/lib/veloxa-engine';
import { getPlanLocalizedPrice, type VeloxaLocale } from '@/lib/veloxa-i18n';
import type {
  BusinessCategory,
  SocialChannelId,
  SubscriptionPlanId,
} from '@/lib/veloxa-types';

const QUICK_BRAND_TEMPLATES: {
  label: string;
  businessName: string;
  city: string;
  category: BusinessCategory;
  targetAudience: string;
  brandTone: string;
}[] = [
  {
    label: '☕ Kopi Senja & Bakery',
    businessName: 'Kopi Senja & Artisan Bakery',
    city: 'Jakarta Selatan',
    category: 'cafe_fnb',
    targetAudience: 'Pekerja muda WFC, pecinta kopi spesialti, & mahasiswa usia 19–38 tahun',
    brandTone: 'Hangat, estetik, menggugah selera, & akrab',
  },
  {
    label: '🏃 Nusantara Run 2026',
    businessName: 'Nusantara Run Festival 2026',
    city: 'Bandung',
    category: 'running_event',
    targetAudience: 'Pelari 5K/10K/Half Marathon, running club, & pecinta olahraga usia 18–45 tahun',
    brandTone: 'Energik, memacu adrenalin, suportif, & informatif',
  },
  {
    label: '✨ Lumina Aesthetic Clinic',
    businessName: 'Lumina Aesthetic & Skin Clinic',
    city: 'Surabaya',
    category: 'clinic_beauty',
    targetAudience: 'Wanita & pria profesional peduli kesehatan kulit wajah usia 22–48 tahun',
    brandTone: 'Elegan, edukatif, terpercaya secara medis, & mewah',
  },
  {
    label: '👗 Velvet Modest Studio',
    businessName: 'Velvet Signature Modest Wear',
    city: 'Bandung & Global',
    category: 'fashion_retail',
    targetAudience: 'Pecinta fashion muslim modern, eksklusif, & kolektor edisi terbatas',
    brandTone: 'Editorial mewah, anggun, inspiratif, & eksklusif',
  },
];

export default function VeloxaOnboardingWizardPage() {
  const router = useRouter();
  const [locale, setLocale] = useState<VeloxaLocale>('id');
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [businessName, setBusinessName] = useState<string>('Kopi Senja & Artisan Bakery');
  const [city, setCity] = useState<string>('Jakarta Selatan');
  const [category, setCategory] = useState<BusinessCategory>('cafe_fnb');
  const [targetAudience, setTargetAudience] = useState<string>(
    'Pekerja muda WFC, pecinta kopi spesialti, & komunitas kreatif usia 19–38 tahun',
  );
  const [brandTone, setBrandTone] = useState<string>(
    'Hangat, estetik, menggugah selera, dan mengundang orang mampir',
  );
  const [selectedChannels, setSelectedChannels] = useState<SocialChannelId[]>([
    'instagram',
    'facebook',
  ]);
  const [selectedPlanId, setSelectedPlanId] = useState<SubscriptionPlanId>('free_trial');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [alreadyOnboarded, setAlreadyOnboarded] = useState<boolean>(false);
  const hasUserEditedRef = useRef<boolean>(false);

  useEffect(() => {
    const applyUser = (u: ReturnType<typeof getInitialAuthenticatedUser>) => {
      if (!u) return;
      setUserEmail(u.email);
      if (u.onboardingCompleted) {
        setAlreadyOnboarded(true);
      }
      // Only prefill form inputs if the user hasn't started editing or stepping through the wizard,
      // and only if the user already completed onboarding previously (not the placeholder "${displayName} Brand")
      if (!hasUserEditedRef.current && u.onboardingCompleted) {
        if (u.businessName) setBusinessName(u.businessName);
        if (u.city) setCity(u.city);
        if (u.category) setCategory(u.category);
        if (u.targetAudience) setTargetAudience(u.targetAudience);
        if (u.brandTone) setBrandTone(u.brandTone);
        if (u.selectedChannels && u.selectedChannels.length > 0) {
          setSelectedChannels(u.selectedChannels.filter(channel => channel === 'instagram' || channel === 'facebook'));
        }
        if (u.subscriptionPlanId) {
          setSelectedPlanId(u.subscriptionPlanId);
        }
      }
    };

    const unsub = subscribeToFirebaseAuthChanges((syncedUser) => {
      if (!syncedUser) { router.replace('/login'); return; }
      applyUser(syncedUser);
    }, () => setErrorMessage('Sesi belum dapat diverifikasi. Silakan masuk kembali.'));
    return () => unsub();
  }, []);

  const toggleChannel = (ch: SocialChannelId) => {
    if (ch !== 'instagram' && ch !== 'facebook') return;
    setSelectedChannels((prev) =>
      prev.includes(ch)
        ? prev.length > 1
          ? prev.filter((item) => item !== ch)
          : prev
        : [...prev, ch],
    );
  };

  const handleFinishOnboarding = async () => {
    if (!businessName.trim() || !city.trim()) {
      setStep(1);
      return;
    }
    setIsSaving(true); setErrorMessage(null);
    try {
      await completeVeloxaOnboarding({
        businessName: businessName.trim(),
        city: city.trim(),
        category,
        targetAudience: targetAudience.trim(),
        brandTone: brandTone.trim(),
        selectedChannels: selectedChannels.filter(channel => channel === 'instagram' || channel === 'facebook'),
        planId: selectedPlanId,
      });
      router.push('/');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Workspace belum tersimpan. Silakan coba lagi.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <VeloxaDedicatedPageShell
      locale={locale}
      onLocaleChange={setLocale}
      maxWidthClass="max-w-[1180px]"
    >
      <div className="space-y-8" data-testid="veloxa-onboarding-wizard-page">
        {errorMessage && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{errorMessage}</div>}
        {/* Top Onboarding Header & 3-Step Progress Stepper */}
        <div className="veloxa-luxury-card-pink rounded-xl border border-pink-200 bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/90 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-[#a92e5d]">
              <Wand2 className="h-3.5 w-3.5 text-[#a92e5d]" />
              Profil bisnis
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Database className="h-3.5 w-3.5" />
              {userEmail
                ? `Tersambung: ${userEmail}`
                : 'Lengkapi profil bisnis'}
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
            Siapkan ruang kreatif bisnis Anda
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm sm:text-base text-neutral-600">
            Konfigurasi profil brand Anda agar 5 Agen OpenAI memahami gaya visual dan bahasa bisnis Anda, lalu pilih{' '}
            <strong className="text-[#a92e5d]">Paket Free Trial (Rp0)</strong> untuk mencoba semua fitur secara gratis.
          </p>

          {alreadyOnboarded && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  Profil brand <strong>{businessName}</strong> sudah tersimpan. Anda dapat memperbaruinya di bawah atau langsung masuk ke Dashboard.
                </span>
              </div>
              <button
                type="button"
                data-testid="onboarding-skip-to-dashboard-btn"
                onClick={() => router.push('/')}
                className="rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition"
              >
                Langsung ke Dashboard →
              </button>
            </div>
          )}

          {/* 3-Step Interactive Stepper */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                num: 1 as const,
                title: '1. Profil & Identitas Brand',
                subtitle: 'Nama bisnis, kota, & industri',
              },
              {
                num: 2 as const,
                title: '2. Target 4 Kanal Sosmed',
                subtitle: 'IG, FB, TikTok, Shorts & AI Ads',
              },
              {
                num: 3 as const,
                title: '3. Pilih Paket (Ada Free Trial!)',
                subtitle: 'Mulai gratis Rp0 atau paket bulanan',
              },
            ].map((item) => {
              const isCurrent = step === item.num;
              const isDone = step > item.num;
              return (
                <button
                  key={item.num}
                  type="button"
                  data-testid={`onboarding-step-btn-${item.num}`}
                  onClick={() => setStep(item.num)}
                  className={`flex items-center gap-3.5 rounded-xl border p-4 text-left transition ${
                    isCurrent
                      ? 'border-2 border-[#EC749B] bg-[#FFF9FB] shadow-sm'
                      : isDone
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : 'border-neutral-200 bg-white hover:border-pink-200'
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${
                      isCurrent
                        ? 'bg-[#bd416e] text-white'
                        : isDone
                          ? 'bg-emerald-600 text-white'
                          : 'bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    {isDone ? '✓' : item.num}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{item.title}</p>
                    <p className="text-xs text-neutral-500">{item.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ====================================================================
           STEP 1: BRAND IDENTITY & INDUSTRY PROFILE
           ==================================================================== */}
        {step === 1 && (
          <section
            data-testid="onboarding-step-1-panel"
            className="veloxa-luxury-card rounded-xl border border-neutral-200 bg-white p-6 sm:p-9 space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-[#a92e5d]">
                  LANGKAH 1 DARI 3 · BRAND BRAIN AI
                </span>
                <h2 className="mt-1 text-xl font-semibold text-neutral-900">
                  Ceritakan Tentang Bisnis atau Event Anda
                </h2>
              </div>

              {/* Quick Fill Templates */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-neutral-500 mr-1">Isi Cepat:</span>
                {QUICK_BRAND_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => {
                      setBusinessName(tpl.businessName);
                      setCity(tpl.city);
                      setCategory(tpl.category);
                      setTargetAudience(tpl.targetAudience);
                      setBrandTone(tpl.brandTone);
                    }}
                    className="rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:border-pink-300 hover:bg-pink-50/70 hover:text-[#a92e5d] transition"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="onboard-business-name"
                  className="block text-sm font-semibold uppercase tracking-wider text-neutral-800"
                >
                  Nama Brand / Bisnis / Event <span className="text-[#a92e5d]">*</span>
                </label>
                <div className="relative mt-1.5">
                  <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    id="onboard-business-name"
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => {
                      hasUserEditedRef.current = true;
                      setBusinessName(e.target.value);
                    }}
                    placeholder="Contoh: Kopi Senja & Artisan Bakery"
                    data-testid="onboard-business-name-input"
                    className="veloxa-auth-input w-full rounded-xl border border-neutral-200 bg-white py-3.5 pl-10 pr-4 text-base font-semibold text-neutral-900"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="onboard-city"
                  className="block text-sm font-semibold uppercase tracking-wider text-neutral-800"
                >
                  Kota / Target Area Utama <span className="text-[#a92e5d]">*</span>
                </label>
                <div className="relative mt-1.5">
                  <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    id="onboard-city"
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Contoh: Jakarta Selatan / Bandung"
                    data-testid="onboard-city-input"
                    className="veloxa-auth-input w-full rounded-xl border border-neutral-200 bg-white py-3.5 pl-10 pr-4 text-base font-semibold text-neutral-900"
                  />
                </div>
              </div>
            </div>

            {/* Category Cards */}
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-neutral-800 mb-2.5">
                Pilih Kategori Industri Bisnis Anda <span className="text-[#a92e5d]">*</span>
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    {
                      id: 'cafe_fnb',
                      title: '☕ Cafe, Resto & Kuliner',
                      desc: 'Promosi menu harian, suasana nongkrong, & paket bundling.',
                    },
                    {
                      id: 'running_event',
                      title: '🏃 Event, Marathon & Konser',
                      desc: 'Hitung mundur H-30 s.d. Hari-H, tiket Early Bird, & jersey.',
                    },
                    {
                      id: 'clinic_beauty',
                      title: '✨ Klinik Kecantikan & Medis',
                      desc: 'Edukasi perawatan, hasil nyata, & konsultasi dokter.',
                    },
                    {
                      id: 'fashion_retail',
                      title: '👗 Fashion, Retail & Produk',
                      desc: 'Katalog koleksi baru, lookbook Reels 9:16, & flash sale.',
                    },
                    {
                      id: 'education',
                      title: '🎓 Edukasi, Kursus & Komunitas',
                      desc: 'Pendaftaran kelas, webinar, & carousel tips edukatif.',
                    },
                    {
                      id: 'custom',
                      title: '🚀 Agensi, Jasa & B2B Lainnya',
                      desc: 'Personal branding, properti, otomotif, & layanan profesional.',
                    },
                  ] as const
                ).map((cat) => {
                  const active = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      data-testid={`onboard-cat-${cat.id}`}
                      onClick={() => setCategory(cat.id)}
                      className={`rounded-xl border p-4 text-left transition ${
                        active
                          ? 'border-2 border-[#EC749B] bg-[#FFF9FB] shadow-xs'
                          : 'border-neutral-200 bg-white hover:border-pink-200'
                      }`}
                    >
                      <p className="text-sm font-semibold text-neutral-900">{cat.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-600">{cat.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="onboard-audience"
                  className="block text-sm font-semibold uppercase tracking-wider text-neutral-800"
                >
                  Target Audiens Pelanggan Anda
                </label>
                <input
                  id="onboard-audience"
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  className="veloxa-auth-input mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm sm:text-base font-semibold text-neutral-900"
                />
              </div>
              <div>
                <label
                  htmlFor="onboard-tone"
                  className="block text-sm font-semibold uppercase tracking-wider text-neutral-800"
                >
                  Gaya Bahasa (Brand Tone of Voice)
                </label>
                <input
                  id="onboard-tone"
                  type="text"
                  value={brandTone}
                  onChange={(e) => setBrandTone(e.target.value)}
                  className="veloxa-auth-input mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm sm:text-base font-semibold text-neutral-900"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                data-testid="onboarding-next-to-step-2"
                onClick={() => setStep(2)}
                className="veloxa-luxury-card-pink inline-flex items-center gap-2 rounded-xl bg-[#bd416e] px-7 py-4 text-base font-semibold text-white transition hover:bg-[#a92e5d]"
              >
                <span>Lanjut ke Langkah 2: Pilih Kanal Sosmed</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}

        {/* ====================================================================
           STEP 2: TARGET SOCIAL CHANNELS & AUTONOMY PREFERENCES
           ==================================================================== */}
        {step === 2 && (
          <section
            data-testid="onboarding-step-2-panel"
            className="veloxa-luxury-card rounded-xl border border-neutral-200 bg-white p-6 sm:p-9 space-y-6"
          >
            <div className="border-b border-neutral-100 pb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#a92e5d]">
                Langkah 2 dari 3 · Akun sosial
              </span>
              <h2 className="mt-1 text-xl font-semibold text-neutral-900">
                Pilih platform untuk bisnis Anda
              </h2>
              <p className="mt-1 text-sm sm:text-base text-neutral-600">
                Anda dapat menghubungkan akun OAuth resmi kapan saja di dalam Dashboard. Pilih kanal target utama Anda:
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  {
                    id: 'instagram',
                    title: 'Instagram',
                    desc: 'Post tunggal, carousel, dan Reels untuk akun profesional.',
                    badge: 'Tersedia',
                  },
                  {
                    id: 'facebook',
                    title: 'Facebook Page',
                    desc: 'Posting dan Reels pada halaman bisnis yang Anda kelola.',
                    badge: 'Tersedia',
                  },
                  {
                    id: 'tiktok',
                    title: 'TikTok',
                    desc: 'Integrasi TikTok sedang disiapkan.',
                    badge: 'Segera hadir',
                  },
                  {
                    id: 'youtube_shorts',
                    title: 'YouTube Shorts',
                    desc: 'Integrasi YouTube Shorts sedang disiapkan.',
                    badge: 'Segera hadir',
                  },
                ] as const
              ).map((ch) => {
                const available = ch.id === 'instagram' || ch.id === 'facebook';
                const selected = available && selectedChannels.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    type="button"
                    data-testid={`onboard-channel-${ch.id}`}
                    disabled={!available}
                    aria-pressed={selected}
                    onClick={() => toggleChannel(ch.id)}
                    className={`flex flex-col justify-between rounded-xl border p-5 text-left transition ${
                      selected
                        ? 'border-2 border-[#EC749B] bg-[#FFF9FB] shadow-xs'
                        : 'border-neutral-200 bg-white opacity-75 hover:opacity-100'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full bg-pink-50 border border-pink-200 px-2.5 py-0.5 text-xs font-semibold text-[#a92e5d]">
                          {ch.badge}
                        </span>
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${
                            selected
                              ? 'bg-[#bd416e] text-white'
                              : 'border border-neutral-300 bg-white text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      </div>
                      <p className="mt-3 text-base font-semibold text-neutral-900">{ch.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-neutral-600">{ch.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-5 py-3.5 text-sm sm:text-base font-medium text-neutral-700 hover:border-pink-200"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Kembali ke Profil Brand</span>
              </button>

              <button
                type="button"
                data-testid="onboarding-next-to-step-3"
                onClick={() => setStep(3)}
                className="veloxa-luxury-card-pink inline-flex items-center gap-2 rounded-xl bg-[#bd416e] px-7 py-4 text-base font-semibold text-white transition hover:bg-[#a92e5d]"
              >
                <span>Lanjut ke Langkah 3: Pilih Paket (Tersedia Free Trial!)</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}

        {/* ====================================================================
           STEP 3: CHOOSE PLAN (WITH PROMINENT FREE TRIAL Rp0 OPTION FIRST!)
           ==================================================================== */}
        {step === 3 && (
          <section
            data-testid="onboarding-step-3-panel"
            className="veloxa-luxury-card rounded-xl border border-neutral-200 bg-white p-6 sm:p-9 space-y-6"
          >
            <div className="border-b border-neutral-100 pb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#a92e5d]">
                LANGKAH 3 DARI 3 · PILIH PAKET (BISA COBA GRATIS DULU!)
              </span>
              <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-neutral-900">
                Mulai dengan Paket Free Trial (Rp0) atau Pilih Paket Langganan Bulanan
              </h2>
              <p className="mt-1 text-sm sm:text-base text-neutral-600">
                Kami menyediakan <strong className="text-[#a92e5d]">Paket Free Trial Gratis</strong> agar Anda bisa langsung menjajal Studio AI, Dual Brand Vault, dan simulasi Meta Ads di dalam Dashboard tanpa bayar di muka.
              </p>
            </div>

            {/* Highlighted Option 1: FREE TRIAL (Rp0) */}
            <div
              onClick={() => setSelectedPlanId('free_trial')}
              data-testid="onboard-plan-free_trial"
              className={`cursor-pointer rounded-xl border-2 p-6 transition ${
                selectedPlanId === 'free_trial'
                  ? 'veloxa-luxury-card-pink border-[#EC749B] bg-[#FFF9FB]'
                  : 'border-neutral-200 bg-white hover:border-pink-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#bd416e] px-3.5 py-1 text-sm font-semibold text-white">
                    <Gift className="h-3.5 w-3.5" />
                    DIREKOMENDASIKAN UNTUK COBA FITUR DULU
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    ✓ Tanpa Kartu Kredit · Aktif Instan
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-2xl sm:text-3xl font-semibold text-[#a92e5d]">
                    Rp0 (Gratis)
                  </span>
                  <span className="text-sm font-medium text-neutral-500"> / 7 Hari Percobaan</span>
                </div>
              </div>

              <h3 className="mt-3 text-lg sm:text-xl font-semibold text-neutral-900">
                🎁 Veloxa Free Trial — Coba Seluruh Fitur Studio AI & Dashboard
              </h3>
              <p className="mt-1 text-sm sm:text-base text-neutral-600">
                Cocok bagi pengguna baru yang ingin membuktikan kualitas produksi Reels 9:16, Carousel 4:5, Dual Brand Vault, dan melihat cara kerja AI Meta Ads sebelum berlangganan.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-4 text-sm font-medium text-neutral-800">
                <div className="flex items-center gap-2 rounded-xl border border-pink-200/80 bg-white p-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#a92e5d]" />
                  <span>10 Konten AI Gratis</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-pink-200/80 bg-white p-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#a92e5d]" />
                  <span>Dual Brand Vault Aktif</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-pink-200/80 bg-white p-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#a92e5d]" />
                  <span>4 Kanal Sosmed Preview</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-pink-200/80 bg-white p-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#a92e5d]" />
                  <span>Simulasi AI Meta Ads</span>
                </div>
              </div>
            </div>

            {/* Paid Monthly Plans Grid */}
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500 mb-3">
                Paket berbayar tersedia setelah integrasi Duitku diaktifkan:
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {(['starter_500k', 'growth_1000k', 'pro_1500k'] as const).map((planId) => {
                  const spec = SUBSCRIPTION_PLANS[planId];
                  const price = getPlanLocalizedPrice(planId, locale);
                  const active = selectedPlanId === planId;
                  return (
                    <div
                      key={planId}
                      aria-disabled="true"
                      data-testid={`onboard-plan-${planId}`}
                      className={`cursor-default rounded-xl border p-5 opacity-70 flex flex-col justify-between ${
                        active
                          ? 'border-2 border-[#EC749B] bg-[#FFF9FB] shadow-sm'
                          : 'border-neutral-200 bg-white hover:border-pink-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-semibold text-neutral-900">{spec.name}</span>
                          {planId === 'pro_1500k' && (
                            <span className="rounded-full bg-[#bd416e] px-2.5 py-0.5 text-xs font-semibold text-white">
                              POPULER
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-2xl font-semibold text-[#a92e5d]">
                          {price.amountFormatted}
                          <span className="text-sm font-semibold text-neutral-500">
                            {price.periodLabel}
                          </span>
                        </p>
                        <p className="mt-1.5 text-sm text-neutral-600 leading-relaxed">
                          {spec.tagline}
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-neutral-100 text-xs font-medium text-neutral-700">
                        ✓ {spec.monthlyPostQuota} Konten/bln · Maks {spec.maxPostsPerDay}x/hari
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-5 py-3.5 text-sm sm:text-base font-medium text-neutral-700 hover:border-pink-200"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Kembali</span>
              </button>

              <button
                type="button"
                disabled={isSaving}
                data-testid="onboarding-finish-btn"
                onClick={() => void handleFinishOnboarding()}
                className="veloxa-luxury-card-pink inline-flex items-center gap-2.5 rounded-xl bg-[#bd416e] px-8 py-4 text-base sm:text-base font-semibold text-white transition hover:bg-[#a92e5d] disabled:opacity-60"
              >
                <Rocket className="h-5 w-5" />
                <span>
                  {isSaving
                    ? 'Menyimpan ke Cloud Firestore & Membuka Dashboard...'
                    : selectedPlanId === 'free_trial'
                      ? 'Aktifkan Free Trial (Rp0) & Masuk ke Dashboard →'
                      : 'Simpan Profil & Masuk ke Dashboard →'}
                </span>
              </button>
            </div>
          </section>
        )}
      </div>
    </VeloxaDedicatedPageShell>
  );
}
