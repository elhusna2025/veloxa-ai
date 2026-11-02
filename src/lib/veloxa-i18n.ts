import type { SubscriptionPlanId } from './veloxa-types';

export type VeloxaLocale = 'id' | 'en' | 'es' | 'ar' | 'ja' | 'ko';

export interface VeloxaLocaleMeta {
  code: VeloxaLocale;
  flag: string;
  label: string;
  nativeName: string;
  regionLabel: string;
  currencyCode: 'IDR' | 'USD' | 'JPY' | 'KRW';
  dir: 'ltr' | 'rtl';
}

export const VELOXA_LOCALES: VeloxaLocaleMeta[] = [
  {
    code: 'id',
    flag: '🇮🇩',
    label: 'ID · Bahasa',
    nativeName: 'Bahasa Indonesia',
    regionLabel: 'Indonesia (IDR)',
    currencyCode: 'IDR',
    dir: 'ltr',
  },
  {
    code: 'en',
    flag: '🇺🇸',
    label: 'EN · English',
    nativeName: 'English (Global)',
    regionLabel: 'Global (USD)',
    currencyCode: 'USD',
    dir: 'ltr',
  },
  {
    code: 'es',
    flag: '🇪🇸',
    label: 'ES · Español',
    nativeName: 'Español',
    regionLabel: 'España & LatAm (USD)',
    currencyCode: 'USD',
    dir: 'ltr',
  },
  {
    code: 'ar',
    flag: '🇸🇦',
    label: 'AR · العربية',
    nativeName: 'العربية',
    regionLabel: 'MENA & Gulf (USD)',
    currencyCode: 'USD',
    dir: 'rtl',
  },
  {
    code: 'ja',
    flag: '🇯🇵',
    label: 'JA · 日本語',
    nativeName: '日本語',
    regionLabel: 'Japan (JPY)',
    currencyCode: 'JPY',
    dir: 'ltr',
  },
  {
    code: 'ko',
    flag: '🇰🇷',
    label: 'KO · 한국어',
    nativeName: '한국어',
    regionLabel: 'Korea (KRW)',
    currencyCode: 'KRW',
    dir: 'ltr',
  },
];

const LOCALE_STORAGE_KEY = 'veloxa_locale_v1';

export function loadSavedVeloxaLocale(): VeloxaLocale {
  if (typeof window === 'undefined') return 'id';
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY) as VeloxaLocale | null;
    if (raw && VELOXA_LOCALES.some((l) => l.code === raw)) {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return 'id';
}

export function saveVeloxaLocale(locale: VeloxaLocale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore storage errors
  }
}

export function getPlanLocalizedPrice(
  planId: SubscriptionPlanId,
  locale: VeloxaLocale,
): { amountFormatted: string; periodLabel: string } {
  const prices: Record<
    SubscriptionPlanId,
    Record<VeloxaLocale, { amountFormatted: string; periodLabel: string }>
  > = {
    free_trial: {
      id: { amountFormatted: 'Rp0 (Gratis)', periodLabel: '/7 hari' },
      en: { amountFormatted: '$0 (Free)', periodLabel: '/7 days' },
      es: { amountFormatted: '$0 (Gratis)', periodLabel: '/7 días' },
      ar: { amountFormatted: '$0 (مجاناً)', periodLabel: '/7 أيام' },
      ja: { amountFormatted: '¥0 (無料)', periodLabel: '/7日間' },
      ko: { amountFormatted: '₩0 (무료)', periodLabel: '/7일' },
    },
    starter_500k: {
      id: { amountFormatted: 'Rp500.000', periodLabel: '/bulan' },
      en: { amountFormatted: '$35', periodLabel: '/month' },
      es: { amountFormatted: '$35', periodLabel: '/mes' },
      ar: { amountFormatted: '$35', periodLabel: '/شهر' },
      ja: { amountFormatted: '¥5,500', periodLabel: '/月' },
      ko: { amountFormatted: '₩49,000', periodLabel: '/월' },
    },
    growth_1000k: {
      id: { amountFormatted: 'Rp1.000.000', periodLabel: '/bulan' },
      en: { amountFormatted: '$69', periodLabel: '/month' },
      es: { amountFormatted: '$69', periodLabel: '/mes' },
      ar: { amountFormatted: '$69', periodLabel: '/شهر' },
      ja: { amountFormatted: '¥10,800', periodLabel: '/月' },
      ko: { amountFormatted: '₩95,000', periodLabel: '/월' },
    },
    pro_1500k: {
      id: { amountFormatted: 'Rp1.500.000', periodLabel: '/bulan' },
      en: { amountFormatted: '$99', periodLabel: '/month' },
      es: { amountFormatted: '$99', periodLabel: '/mes' },
      ar: { amountFormatted: '$99', periodLabel: '/شهر' },
      ja: { amountFormatted: '¥15,500', periodLabel: '/月' },
      ko: { amountFormatted: '₩139,000', periodLabel: '/월' },
    },
  };
  return prices[planId][locale];
}

export interface VeloxaLandingCopy {
  headerBadgePublic: string;
  headerSignIn: string;
  headerStartFree: string;
  headerLogout: string;
  heroBadge: string;
  heroTitlePre: string;
  heroTitleHighlight: string;
  heroTitlePost: string;
  heroSubtitle: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  heroTrustPill1: string;
  heroTrustPill2: string;
  heroTrustPill3: string;
  heroTrustPill4: string;
  bentoReelsBadge: string;
  bentoCarouselBadge: string;
  bentoSinglePostBadge: string;
  bentoMetaAdsBadge: string;
  galleryEyebrow: string;
  galleryTitle: string;
  gallerySubtitle: string;
  formatReelsTitle: string;
  formatCarouselTitle: string;
  formatSingleTitle: string;
  vaultEyebrow: string;
  vaultTitle: string;
  vaultSubtitle: string;
  vaultDrawer1Title: string;
  vaultDrawer1Desc: string;
  vaultDrawer2Title: string;
  vaultDrawer2Desc: string;
  vaultOutputTitle: string;
  vaultOutputDesc: string;
  nativeEyebrow: string;
  nativeTitle: string;
  nativeSubtitle: string;
  compareTitle: string;
  compareSubtitle: string;
  compareOldBadge: string;
  compareOldPrice: string;
  compareOldBullets: [string, string, string];
  compareNewBadge: string;
  compareNewPrice: string;
  compareNewBullets: [string, string, string];
  pricingEyebrow: string;
  pricingTitle: string;
  pricingSubtitle: string;
  pricingMostPopular: string;
  pricingStartBtn: string;
  pricingQuotaLabel: string;
  pricingChannelsLabel: string;
  pricingEventModeLabel: string;
  pricingMetaAdsLabel: string;
  pricingIncluded: string;
  pricingNotIncluded: string;
  workspaceTabs: {
    overview: string;
    brand_vault: string;
    studio: string;
    autonomy: string;
    meta_ads: string;
  };
  mobileTabs: {
    overview: string;
    brand_vault: string;
    studio: string;
    autonomy: string;
    meta_ads: string;
  };
}

export const VELOXA_I18N_COPY: Record<VeloxaLocale, VeloxaLandingCopy> = {
  id: {
    headerBadgePublic: 'Global Autonomous Social & Meta Ads SaaS',
    headerSignIn: 'Masuk Akun',
    headerStartFree: 'Daftarkan Bisnis',
    headerLogout: 'Keluar',
    heroBadge: 'Platform AI Kreator 4 Sosmed & Meta Ads Otonom Kelas Dunia',
    heroTitlePre: 'Tim Produksi Reels, Carousel, Poster & AI Media Buyer 24/7 Mulai ',
    heroTitleHighlight: 'Rp500.000/Bulan',
    heroTitlePost: '',
    heroSubtitle:
      'Unggah referensi visual yang Anda kagumi dan stok foto produk/event asli Anda. Veloxa AI merancang Reels 9:16, Carousel 4:5, & Feed Poster berkelas agensi global, memvalidasi kualitas hingga 0 kesalahan, memposting otomatis ke Instagram, Facebook, TikTok, & YouTube Shorts, serta mengoptimasi iklan Meta Ads setiap hari.',
    heroPrimaryCta: 'Mulai Produksi Konten Bisnis Anda',
    heroSecondaryCta: 'Masuk ke Live Workspace →',
    heroTrustPill1: '99/100 Self-Healing Quality Gate',
    heroTrustPill2: 'Otonom 4 Kanal (IG, FB, TikTok, YT)',
    heroTrustPill3: 'AI Meta Ads Optimizer 24/7',
    heroTrustPill4: 'Web, Android (.apk) & iOS Native',
    bentoReelsBadge: 'REELS & TIKTOK 9:16 + AI VOICEOVER',
    bentoCarouselBadge: 'CAROUSEL 4:5 INTERAKTIF (4 SLIDE)',
    bentoSinglePostBadge: 'SINGLE FEED POSTER & AD CREATIVE',
    bentoMetaAdsBadge: 'AI META ADS MEDIA BUYER · ROAS 6.4x',
    galleryEyebrow: 'GALERI VISUAL KONTEN NYATA (REELS · CAROUSEL · SINGLE POST)',
    galleryTitle: 'Visual Setara Agensi Kreatif Internasional, Diproduksi Otomatis untuk Brand Anda',
    gallerySubtitle:
      'Pilih industri bisnis Anda di bawah ini untuk melihat langsung contoh nyata Reels 9:16, Carousel multi-slide interaktif, dan Single Feed Poster yang dihasilkan dari perpaduan Style DNA + Foto Produk Asli.',
    formatReelsTitle: '1. Video Reels / TikTok / Shorts (9:16)',
    formatCarouselTitle: '2. Carousel Edukasi & Katalog (4:5 Multi-Slide)',
    formatSingleTitle: '3. Single Poster & Meta Ads Creative (4:5)',
    vaultEyebrow: 'ARSITEKTUR DUAL BRAND VAULT & 5 OPENAI AGENTS',
    vaultTitle: 'Bagaimana Veloxa AI Mengubah Foto Biasa Menjadi Konten Kelas Dunia?',
    vaultSubtitle:
      'Tanpa perlu keahlian desain atau editing video. Sistem 2 Laci Brand Vault kami memastikan setiap konten 100% menampilkan produk asli Anda dengan estetika visual papan atas.',
    vaultDrawer1Title: 'Laci 1 · Referensi Gaya (Style DNA)',
    vaultDrawer1Desc:
      'Unggah contoh poster, carousel, atau Reels dari brand favorit dunia. Vision AI mengekstrak komposisi warna, tipografi, ritme hook, dan tata letak.',
    vaultDrawer2Title: 'Laci 2 · Stok Foto & Video Asli Bisnis',
    vaultDrawer2Desc:
      'Unggah foto menu kopi, suasana event lari, produk fashion, atau klinik Anda langsung dari kamera HP Android/iOS maupun desktop.',
    vaultOutputTitle: 'Hasil · Konten Siap Tayang & Iklan Meta Ads Pemenang',
    vaultOutputDesc:
      '5 Agen AI memproduksi visual + naskah + voiceover, memeriksa kualitas hingga skor >=88/100 (0 typo), menerbitkan ke 4 sosmed, dan menjalankan A/B test Meta Ads.',
    nativeEyebrow: 'PENGALAMAN NATIVE MOBILE (ANDROID & iOS) + WEB DESKTOP',
    nativeTitle: 'Kendalikan Seluruh Kampanye Sosial & Meta Ads dari Genggaman Anda',
    nativeSubtitle:
      'Dirancang dengan arsitektur Local-First (hemat 99% biaya cloud) dan antarmuka native yang super mulus di iPhone, Android, maupun layar desktop.',
    compareTitle: 'Perbandingan Investasi: Sewa Agensi Konvensional vs. Veloxa AI',
    compareSubtitle:
      'Hemat hingga 85% biaya bulanan dengan kecepatan produksi 10x lebih cepat dan optimasi iklan otomatis 24 jam.',
    compareOldBadge: 'Cara Lama (Agensi Sosmed + Freelancer Advertiser)',
    compareOldPrice: 'Rp6.500.000 – Rp9.000.000 / bln',
    compareOldBullets: [
      'Biaya desainer grafis, video editor Reels, & copywriter: ~Rp4.500.000/bulan',
      'Jasa kelola Meta Ads bulanan: ~Rp2.500.000/bulan (belum termasuk budget iklan)',
      'Revisi memakan waktu berhari-hari & sering kehilangan momentum promosi',
    ],
    compareNewBadge: '★ Cara Baru Bersama Veloxa AI (Hemat 85%)',
    compareNewPrice: 'Rp500.000 – Rp1.500.000 / bln',
    compareNewBullets: [
      '20 hingga 90 konten/bulan (Reels 9:16, Carousel 4:5, Single Post) tayang otomatis di 4 kanal',
      'Self-Healing Quality Gate memastikan 0 kesalahan visual/teks sebelum tayang',
      'AI Agent Meta Ads 24/7 otomatis mematikan iklan mahal & mengalihkan budget ke pemenang',
    ],
    pricingEyebrow: 'HARGA TRANSPARAN UNTUK PASAR INDONESIA & GLOBAL',
    pricingTitle: 'Pilih Paket Berlangganan Sesuai Skala Pertumbuhan Brand Anda',
    pricingSubtitle:
      'Bebas potongan komisi 30% App Store melalui pembayaran Web instan (QRIS, Virtual Account, & Kartu Global).',
    pricingMostPopular: 'PALING POPULER',
    pricingStartBtn: 'Mulai dengan Paket Ini',
    pricingQuotaLabel: 'Kuota Produksi & Tayang',
    pricingChannelsLabel: 'Kanal Sosial Media',
    pricingEventModeLabel: 'Mode Kampanye Event (H-30 s.d. Hari-H)',
    pricingMetaAdsLabel: 'AI Agent Meta Ads & Auto-Optimizer',
    pricingIncluded: 'Termasuk Penuh',
    pricingNotIncluded: 'Tidak Termasuk',
    workspaceTabs: {
      overview: '1. Beranda & Kanal',
      brand_vault: '2. Brand & Referensi',
      studio: '3. Studio Konten',
      autonomy: '4. Agent Otonom',
      meta_ads: '5. AI Meta Ads',
    },
    mobileTabs: {
      overview: 'Beranda',
      brand_vault: 'Vault',
      studio: 'Studio',
      autonomy: 'Otonom',
      meta_ads: 'Meta Ads',
    },
  },
  en: {
    headerBadgePublic: 'Global Autonomous Social & Meta Ads SaaS',
    headerSignIn: 'Sign In',
    headerStartFree: 'Launch Your Brand',
    headerLogout: 'Sign Out',
    heroBadge: '#1 Autonomous 4-Channel Content Studio & AI Meta Ads Media Buyer',
    heroTitlePre: 'Your 24/7 Reels, Carousel, Feed & AI Meta Ads Creative Team Starting at ',
    heroTitleHighlight: '$35/Month',
    heroTitlePost: '',
    heroSubtitle:
      'Upload visual references you love and your authentic product or event photos. Veloxa AI crafts agency-grade 9:16 Reels, 4:5 Carousels, and Single Feed Posts, passes a 0-error Quality Gate, auto-publishes to Instagram, Facebook, TikTok, & YouTube Shorts, and optimizes your Meta Ads daily.',
    heroPrimaryCta: 'Start Creating For Your Brand',
    heroSecondaryCta: 'Open Live Workspace Demo →',
    heroTrustPill1: '99/100 Self-Healing Quality Gate',
    heroTrustPill2: '4-Channel Auto-Publish (IG, FB, TikTok, YT)',
    heroTrustPill3: '24/7 AI Meta Ads ROAS Optimizer',
    heroTrustPill4: 'Web, Android (.apk) & iOS Native',
    bentoReelsBadge: '9:16 REELS & TIKTOK + AI VOICEOVER',
    bentoCarouselBadge: 'INTERACTIVE 4:5 CAROUSEL (4 SLIDES)',
    bentoSinglePostBadge: 'SINGLE FEED POSTER & AD CREATIVE',
    bentoMetaAdsBadge: 'AI META ADS MEDIA BUYER · 6.4x ROAS',
    galleryEyebrow: 'LIVE VISUAL SHOWCASE (REELS · CAROUSELS · SINGLE POSTS)',
    galleryTitle: 'World-Class Creative Agency Visuals, Autonomously Produced for Your Brand',
    gallerySubtitle:
      'Select an industry below to inspect real 9:16 Reels, interactive multi-slide 4:5 Carousels, and high-converting Single Posters generated from Style DNA + Real Brand Assets.',
    formatReelsTitle: '1. Vertical Reels / TikTok / Shorts (9:16)',
    formatCarouselTitle: '2. Multi-Slide Storytelling Carousel (4:5)',
    formatSingleTitle: '3. Single Feed Poster & Meta Ad Creative (4:5)',
    vaultEyebrow: 'DUAL BRAND VAULT & 5 OPENAI AGENTS ARCHITECTURE',
    vaultTitle: 'How Veloxa AI Transforms Everyday Photos into Luxury Social Campaigns',
    vaultSubtitle:
      'Zero design or video editing skills required. Our Dual Brand Vault guarantees every post features your authentic products styled with world-class art direction.',
    vaultDrawer1Title: 'Drawer 1 · Style DNA References',
    vaultDrawer1Desc:
      'Upload posters, carousels, or Reels you admire. Vision AI extracts color palettes, typography hierarchy, hook pacing, and layout geometry.',
    vaultDrawer2Title: 'Drawer 2 · Authentic Product & Event Photos',
    vaultDrawer2Desc:
      'Snap and upload real coffee menus, marathon moments, clinic treatments, or fashion pieces straight from your iPhone, Android, or desktop.',
    vaultOutputTitle: 'Output · Published 4-Channel Content & Winning Meta Ads',
    vaultOutputDesc:
      '5 specialized AI agents craft visuals, captions, and voiceovers, verify quality (>=88/100 score, 0 typos), publish across 4 platforms, and scale winning Meta Ads.',
    nativeEyebrow: 'LUXURY NATIVE MOBILE (iOS & ANDROID) + DESKTOP WEB',
    nativeTitle: 'Command Your Entire Social & Meta Ads Empire From Your Pocket',
    nativeSubtitle:
      'Engineered with a Local-First sync engine (cutting cloud database costs by 99%) and a silky-smooth native mobile experience on iOS, Android, and Web.',
    compareTitle: 'Monthly Investment: Traditional Retainer Agency vs. Veloxa AI',
    compareSubtitle:
      'Save up to 85% every month while shipping 10x faster with 24/7 autonomous ad optimization.',
    compareOldBadge: 'Old Way (Social Agency + Freelance Media Buyer)',
    compareOldPrice: '$1,500 – $3,500 / month',
    compareOldBullets: [
      'Social media designer, Reels editor, & copywriter retainer: ~$1,200/month',
      'Meta Ads management fee: ~$800/month (excluding ad spend)',
      'Slow turnaround times, endless revisions, and missed campaign windows',
    ],
    compareNewBadge: '★ The Veloxa AI Way (Save up to 85%)',
    compareNewPrice: '$35 – $99 / month',
    compareNewBullets: [
      '20 to 90 posts/month (9:16 Reels, 4:5 Carousels, Single Posts) auto-published to 4 channels',
      'Self-Healing Quality Gate enforces zero visual or copy errors before publishing',
      '24/7 AI Meta Ads Agent pauses expensive losers and scales 100% budget to winning creatives',
    ],
    pricingEyebrow: 'TRANSPARENT GLOBAL PRICING',
    pricingTitle: 'Choose the Plan Built for Your Stage of Growth',
    pricingSubtitle:
      'Instant web checkout with zero 30% app store tax. Cancel or upgrade anytime in one click.',
    pricingMostPopular: 'MOST POPULAR',
    pricingStartBtn: 'Get Started with',
    pricingQuotaLabel: 'Monthly Content Quota',
    pricingChannelsLabel: 'Connected Channels',
    pricingEventModeLabel: 'Event Countdown Mode (T-30 to Event Day)',
    pricingMetaAdsLabel: 'AI Meta Ads Agent & Auto-Optimizer',
    pricingIncluded: 'Included',
    pricingNotIncluded: 'Not Included',
    workspaceTabs: {
      overview: '1. Channels & Home',
      brand_vault: '2. Brand & Vault',
      studio: '3. Content Studio',
      autonomy: '4. Autonomy Engine',
      meta_ads: '5. AI Meta Ads',
    },
    mobileTabs: {
      overview: 'Home',
      brand_vault: 'Vault',
      studio: 'Studio',
      autonomy: 'Autonomy',
      meta_ads: 'Meta Ads',
    },
  },
  es: {
    headerBadgePublic: 'SaaS Global Autónomo de Redes y Meta Ads',
    headerSignIn: 'Iniciar Sesión',
    headerStartFree: 'Registrar Marca',
    headerLogout: 'Salir',
    heroBadge: 'Estudio Autónomo #1 de Reels, Carruseles y Meta Ads con IA',
    heroTitlePre: 'Tu Equipo Creativo 24/7 de Reels, Carruseles y Meta Ads Desde ',
    heroTitleHighlight: '$35/Mes',
    heroTitlePost: '',
    heroSubtitle:
      'Sube referencias visuales que te encanten y las fotos reales de tu negocio. Veloxa AI diseña Reels 9:16, Carruseles 4:5 y Posters de nivel agencia, valida la calidad con 0 errores, publica en Instagram, Facebook, TikTok y YouTube Shorts, y optimiza tus campañas de Meta Ads cada día.',
    heroPrimaryCta: 'Impulsa Tu Marca Ahora',
    heroSecondaryCta: 'Abrir Demo del Workspace →',
    heroTrustPill1: 'Control de Calidad IA 99/100',
    heroTrustPill2: '4 Canales Automáticos (IG, FB, TikTok, YT)',
    heroTrustPill3: 'Optimizador Meta Ads 24/7',
    heroTrustPill4: 'Web, Android (.apk) e iOS Nativo',
    bentoReelsBadge: 'REELS Y TIKTOK 9:16 + LOCUCIÓN IA',
    bentoCarouselBadge: 'CARRUSEL 4:5 INTERACTIVO (4 SLIDES)',
    bentoSinglePostBadge: 'POSTER FEED Y ANUNCIO META ADS',
    bentoMetaAdsBadge: 'IA MEDIA BUYER META ADS · ROAS 6.4x',
    galleryEyebrow: 'GALERÍA VISUAL EN VIVO (REELS · CARRUSELES · POSTS)',
    galleryTitle: 'Diseño de Agencia Internacional, Producido Automáticamente para Tu Negocio',
    gallerySubtitle:
      'Explora ejemplos reales de Reels 9:16, Carruseles interactivos de 4 diapositivas y Posts individuales creados combinando ADN de Estilo + Fotos Reales.',
    formatReelsTitle: '1. Video Vertical Reels / TikTok / Shorts (9:16)',
    formatCarouselTitle: '2. Carrusel Interactivo Multi-Slide (4:5)',
    formatSingleTitle: '3. Poster Individual y Creativo Meta Ads (4:5)',
    vaultEyebrow: 'ARQUITECTURA DUAL BRAND VAULT + 5 AGENTES OPENAI',
    vaultTitle: 'Cómo Veloxa AI Convierte Fotos Reales en Contenido de Lujo',
    vaultSubtitle:
      'Sin necesidad de diseñadores ni editores de video. Nuestro sistema de 2 cajones garantiza que cada publicación muestre tus productos reales con dirección de arte premium.',
    vaultDrawer1Title: 'Cajón 1 · Referencias de Estilo (Style DNA)',
    vaultDrawer1Desc:
      'Sube ejemplos de posts o Reels que admires. Vision AI extrae paleta de colores, tipografía, ritmo visual y estructura de gancho.',
    vaultDrawer2Title: 'Cajón 2 · Fotos y Videos Reales de Tu Marca',
    vaultDrawer2Desc:
      'Sube fotos de tu cafetería, evento deportivo, clínica o tienda directamente desde tu móvil iOS/Android o navegador.',
    vaultOutputTitle: 'Resultado · Publicación en 4 Redes + Meta Ads Ganadores',
    vaultOutputDesc:
      '5 agentes IA producen visuales, copy y locución, aprueban el filtro de calidad (>=88/100), publican en 4 plataformas y escalan el presupuesto hacia los anuncios ganadores.',
    nativeEyebrow: 'EXPERIENCIA MÓVIL NATIVA (iOS Y ANDROID) + WEB',
    nativeTitle: 'Controla Todas Tus Redes y Anuncios Meta Ads Desde Tu Móvil',
    nativeSubtitle:
      'Arquitectura Local-First ultrarrápida (99% menos consumo en la nube) con interfaz nativa para iPhone, Android y escritorio.',
    compareTitle: 'Comparativa Mensual: Agencia Tradicional vs. Veloxa AI',
    compareSubtitle:
      'Ahorra hasta un 85% mensual multiplicando por 10 la velocidad de producción y optimización publicitaria.',
    compareOldBadge: 'Método Tradicional (Agencia + Trafficker)',
    compareOldPrice: '$1,500 – $3,500 / mes',
    compareOldBullets: [
      'Diseñador gráfico, editor de Reels y community manager: ~$1,200/mes',
      'Gestión de campañas Meta Ads: ~$800/mes (sin incluir inversión publicitaria)',
      'Revisiones lentas y pérdida de oportunidades en fechas clave',
    ],
    compareNewBadge: '★ Con Veloxa AI (Ahorra hasta 85%)',
    compareNewPrice: '$35 – $99 / mes',
    compareNewBullets: [
      '20 a 90 contenidos/mes (Reels 9:16, Carruseles 4:5, Posts) publicados en 4 canales',
      'Filtro de Calidad Autocorrectivo con 0 errores antes de publicar',
      'Agente IA Meta Ads 24/7 que pausa anuncios caros y escala los ganadores',
    ],
    pricingEyebrow: 'PRECIOS GLOBALES TRANSPARENTES',
    pricingTitle: 'Elige el Plan Ideal para el Crecimiento de Tu Negocio',
    pricingSubtitle:
      'Pago web directo sin el 30% de comisión de las tiendas de aplicaciones.',
    pricingMostPopular: 'MÁS POPULAR',
    pricingStartBtn: 'Comenzar con',
    pricingQuotaLabel: 'Cuota Mensual de Contenido',
    pricingChannelsLabel: 'Canales Conectados',
    pricingEventModeLabel: 'Modo Campaña de Eventos (Cuenta Regresiva)',
    pricingMetaAdsLabel: 'Agente IA Meta Ads y Auto-Optimizador',
    pricingIncluded: 'Incluido',
    pricingNotIncluded: 'No Incluido',
    workspaceTabs: {
      overview: '1. Inicio y Canales',
      brand_vault: '2. Marca y Vault',
      studio: '3. Estudio IA',
      autonomy: '4. Autonomía',
      meta_ads: '5. IA Meta Ads',
    },
    mobileTabs: {
      overview: 'Inicio',
      brand_vault: 'Vault',
      studio: 'Estudio',
      autonomy: 'Autónomo',
      meta_ads: 'Meta Ads',
    },
  },
  ar: {
    headerBadgePublic: 'منصة عالمية ذكية لمحتوى التواصل وإعلانات ميتا',
    headerSignIn: 'تسجيل الدخول',
    headerStartFree: 'ابدأ الآن',
    headerLogout: 'خروج',
    heroBadge: 'المنصة الذكية الأولى عالمياً لإنتاج الريلز والكاروسيل وإدارة إعلانات Meta Ads',
    heroTitlePre: 'فريقك الإبداعي المتكامل لإنتاج الريلز والكاروسيل وإدارة إعلانات ميتا على مدار الساعة يبدأ من ',
    heroTitleHighlight: '$35/شهرياً',
    heroTitlePost: '',
    heroSubtitle:
      'ارفع نماذج التصاميم التي تعجبك وصور منتجاتك الحقيقية. يقوم Veloxa AI بتصميم فيديوهات ريلز 9:16 وكاروسيل 4:5 احترافية، وفحص الجودة بنسبة أخطاء صفرية، والنشر التلقائي على إنستغرام وفيسبوك وتيك توك ويوتيوب شورتس مع تحسين حملات Meta Ads يومياً.',
    heroPrimaryCta: 'ابدأ بتنمية علامتك التجارية الآن',
    heroSecondaryCta: 'استعرض لوحة التحكم الحية ←',
    heroTrustPill1: 'بوابة جودة ذكية 99/100 بدون أخطاء',
    heroTrustPill2: 'نشر تلقائي على 4 منصات عالمية',
    heroTrustPill3: 'تحسين إعلانات Meta Ads 24/7',
    heroTrustPill4: 'تطبيق ويب وأندرويد و iOS أصيل',
    bentoReelsBadge: 'ريلز وتيك توك 9:16 + تعليق صوتي ذكي',
    bentoCarouselBadge: 'كاروسيل تفاعلي 4:5 (4 شرائح)',
    bentoSinglePostBadge: 'بوستر احترافي وإعلان ميتا ممول',
    bentoMetaAdsBadge: 'مدير إعلانات ميتا الذكي · عائد 6.4x',
    galleryEyebrow: 'معرض الأعمال الحية (ريلز · كاروسيل · بوسترات)',
    galleryTitle: 'تصاميم بمستوى وكالات الإعلان العالمية، تُنتج تلقائياً لعلامتك التجارية',
    gallerySubtitle:
      'اختر قطاع عملك أدناه لمعاينة نماذج حية من فيديوهات الريلز 9:16، وشرائح الكاروسيل التفاعلية، والبوسترات الإعلانية المصممة من صور منتجاتك الحقيقية.',
    formatReelsTitle: '1. فيديو ريلز / تيك توك / شورتس (9:16)',
    formatCarouselTitle: '2. كاروسيل قصصي متعدد الشرائح (4:5)',
    formatSingleTitle: '3. بوستر فردي وإعلان Meta Ads (4:5)',
    vaultEyebrow: 'تقنية الخزنة المزدوجة + 5 وكلاء ذكاء اصطناعي',
    vaultTitle: 'كيف يحوّل Veloxa AI صور منتجاتك إلى حملات تسويقية فاخرة؟',
    vaultSubtitle:
      'دون الحاجة لخبرة في التصميم أو المونتاج. يدمج النظام بين البصمة البصرية المرجعية وصور منتجاتك الحقيقية بدقة فائقة.',
    vaultDrawer1Title: 'الدرج الأول · مراجع الهوية البصرية (Style DNA)',
    vaultDrawer1Desc:
      'ارفع أمثلة للريلز أو البوسترات التي تعجبك، ليقوم الذكاء البصري باستخلاص الألوان والخطوط وإيقاع الجذب.',
    vaultDrawer2Title: 'الدرج الثاني · صور وفيديوهات منتجاتك الحقيقية',
    vaultDrawer2Desc:
      'ارفع صور منتجاتك أو فعالياتك مباشرة من هاتفك (iOS / Android) أو الحاسوب.',
    vaultOutputTitle: 'النتيجة · نشر تلقائي على 4 قنوات وحملات إعلانية رابحة',
    vaultOutputDesc:
      'ينتج 5 وكلاء ذكاء اصطناعي التصاميم والنصوص والتعليق الصوتي، مع فحص الجودة وتوجيه ميزانية الإعلانات نحو الإعلان الأعلى عائداً.',
    nativeEyebrow: 'تجربة تطبيقات أصلية فاخرة (iOS & Android) + ويب',
    nativeTitle: 'تحكّم في جميع قنواتك وحملاتك الإعلانية من هاتفك بلمسة واحدة',
    nativeSubtitle:
      'مبني بتقنية Local-First الفائقة السرعة لتوفير 99% من استهلاك السحابة مع واجهة متجاوبة بالكامل.',
    compareTitle: 'مقارنة التكلفة الشهرية: الوكالات التقليدية مقابل Veloxa AI',
    compareSubtitle:
      'وفّر حتى 85% من التكاليف الشهرية مع سرعة إنتاج أعلى بـ 10 أضعاف.',
    compareOldBadge: 'الطريقة التقليدية (وكالة تسويق + خبير إعلانات)',
    compareOldPrice: '$1,500 – $3,500 / شهرياً',
    compareOldBullets: [
      'تكلفة مصمم الجرافيك ومونتير الريلز وكاتب المحتوى: ~$1,200/شهرياً',
      'إدارة حملات Meta Ads: ~$800/شهرياً (غير شامل ميزانية الإعلان)',
      'بطء في التعديلات وتأخر في مواكبة المواسم التسويقية',
    ],
    compareNewBadge: '★ الطريقة الحديثة مع Veloxa AI (وفّر 85%)',
    compareNewPrice: '$35 – $99 / شهرياً',
    compareNewBullets: [
      '20 إلى 90 منشوراً شهرياً (ريلز 9:16، كاروسيل 4:5، بوسترات) تُنشر تلقائياً',
      'بوابة فحص الجودة الذاتية تضمن خلو المحتوى من الأخطاء قبل النشر',
      'وكيل Meta Ads الذكي يوقف الإعلانات المكلفة ويوجه 100% من الميزانية للإعلان الرابح',
    ],
    pricingEyebrow: 'أسعار عالمية واضحة ومرنة',
    pricingTitle: 'اختر الباقة المناسبة لحجم نمو أعمالك',
    pricingSubtitle:
      'دفع إلكتروني مباشر عبر الويب بدون عمولة المتاجر البالغة 30%.',
    pricingMostPopular: 'الأكثر طلباً',
    pricingStartBtn: 'ابدأ الآن بباقة',
    pricingQuotaLabel: 'حصة المحتوى الشهرية',
    pricingChannelsLabel: 'القنوات المتصلة',
    pricingEventModeLabel: 'وضع حملات الفعاليات والعد التنازلي',
    pricingMetaAdsLabel: 'وكيل إعلانات Meta Ads والتحسين التلقائي',
    pricingIncluded: 'مشمول بالكامل',
    pricingNotIncluded: 'غير مشمول',
    workspaceTabs: {
      overview: '1. الرئيسية والقنوات',
      brand_vault: '2. الهوية والخزنة',
      studio: '3. استوديو المحتوى',
      autonomy: '4. الجدولة الذاتية',
      meta_ads: '5. إعلانات ميتا الذكية',
    },
    mobileTabs: {
      overview: 'الرئيسية',
      brand_vault: 'الخزنة',
      studio: 'الاستوديو',
      autonomy: 'تلقائي',
      meta_ads: 'إعلانات ميتا',
    },
  },
  ja: {
    headerBadgePublic: 'グローバル自律型SNS・Meta広告AI SaaS',
    headerSignIn: 'ログイン',
    headerStartFree: '無料で始める',
    headerLogout: 'ログアウト',
    heroBadge: '世界水準の4大SNS自動制作＆AI Meta広告メディアバイヤー',
    heroTitlePre: '24時間稼働のリール・カルーセル制作＆AI Meta広告運用チームを月額 ',
    heroTitleHighlight: '¥5,500から',
    heroTitlePost: '',
    heroSubtitle:
      '憧れの参考デザインと自社の商品・イベント写真をアップロードするだけ。Veloxa AIがプロ品質の9:16リール、4:5カルーセル、フィード投稿を生成し、品質ゲートでエラーゼロを確認後、Instagram・Facebook・TikTok・YouTube Shortsへ自動投稿＆Meta広告を毎日最適化します。',
    heroPrimaryCta: 'ブランドの自動運用を始める',
    heroSecondaryCta: 'ライブワークスペースを体験 →',
    heroTrustPill1: '99/100 自己修復型クオリティゲート',
    heroTrustPill2: '4大SNS同時自動投稿 (IG/FB/TikTok/YT)',
    heroTrustPill3: '24時間AI Meta広告ROAS最適化',
    heroTrustPill4: 'Web・Android・iOSネイティブ対応',
    bentoReelsBadge: '9:16 リール＆TikTok + AIナレーション',
    bentoCarouselBadge: '4:5 インタラクティブ・カルーセル (4枚組)',
    bentoSinglePostBadge: 'シングルポスター＆Meta広告クリエイティブ',
    bentoMetaAdsBadge: 'AI Meta広告バイヤー · ROAS 6.4倍',
    galleryEyebrow: 'ライブ制作ギャラリー (リール · カルーセル · シングル投稿)',
    galleryTitle: 'トップクリエイティブエージェンシー品質を、あなたのブランドへ自動提供',
    gallerySubtitle:
      '業種タブを切り替えて、スタイルDNAと実際の写真から自動生成された9:16縦型リール、4枚組カルーセル、シングルポスターをご覧ください。',
    formatReelsTitle: '1. 縦型ショート動画 Reels / TikTok / Shorts (9:16)',
    formatCarouselTitle: '2. ストーリー型マルチスライド・カルーセル (4:5)',
    formatSingleTitle: '3. シングルフィード投稿＆Meta広告バナー (4:5)',
    vaultEyebrow: 'デュアル・ブランドボールト＆5つのOpenAIエージェント',
    vaultTitle: '日常の商品写真が、なぜラグジュアリーなSNSキャンペーンに変わるのか？',
    vaultSubtitle:
      'デザインや動画編集のスキルは一切不要。2つのアセット引き出しが、自社の本物の写真と一流のアートディレクションを融合させます。',
    vaultDrawer1Title: '引き出し1 · スタイルDNAリファレンス',
    vaultDrawer1Desc:
      '好きなブランドのリールやポスターを登録。Vision AIが配色・タイポグラフィ・フックの構成を自動抽出します。',
    vaultDrawer2Title: '引き出し2 · 自社の本物の商品・店舗・イベント写真',
    vaultDrawer2Desc:
      'iPhone・Android・PCからメニューやイベントの写真をそのままアップロード。',
    vaultOutputTitle: '出力 · 4チャネル自動公開＆勝ちクリエイティブ広告スケール',
    vaultOutputDesc:
      '5つのAIエージェントが画像・キャプション・音声を生成し、88点以上の品質基準をクリアした投稿のみを公開＆Meta広告予算を勝ちパターンへ自動配分します。',
    nativeEyebrow: 'ネイティブモバイル (iOS / Android) ＆ デスクトップWeb',
    nativeTitle: 'スマートフォンひとつで、SNS発信からMeta広告運用まで完全掌握',
    nativeSubtitle:
      'Local-First同期エンジンによりクラウド通信コストを99%削減し、iOS・Android・Webで驚くほど滑らかな操作感を実現。',
    compareTitle: '月額コスト比較：従来の制作会社・広告代理店 vs Veloxa AI',
    compareSubtitle:
      '制作スピードを10倍に高めながら、毎月の外注コストを最大85%削減。',
    compareOldBadge: '従来の方法（SNS運用代行＋広告運用フリーランス）',
    compareOldPrice: '¥220,000 – ¥450,000 / 月',
    compareOldBullets: [
      'デザイナー・リール編集・ライター外注費：約¥180,000/月',
      'Meta広告運用代行手数料：約¥100,000/月（広告費別）',
      '修正の往復に数日かかり、キャンペーンの好機を逃しやすい',
    ],
    compareNewBadge: '★ Veloxa AI（コスト最大85%削減）',
    compareNewPrice: '¥5,500 – ¥15,500 / 月',
    compareNewBullets: [
      '月20〜90本（9:16リール・4:5カルーセル・ポスター）を4大SNSへ自動公開',
      '自己修復クオリティゲートが公開前にデザインと文章のミスをゼロに',
      '24時間AI Meta広告エージェントが負け広告を停止し、勝ち広告へ予算を100%集中',
    ],
    pricingEyebrow: 'シンプルで透明性の高いグローバル料金プラン',
    pricingTitle: 'ビジネスの成長フェーズに合わせて選べる3つのプラン',
    pricingSubtitle:
      'Web決済対応によりアプリストア手数料30%をカット。いつでもワンクリックで変更可能。',
    pricingMostPopular: '一番人気',
    pricingStartBtn: 'このプランで始める：',
    pricingQuotaLabel: '月間コンテンツ制作枠',
    pricingChannelsLabel: '対応SNSチャネル',
    pricingEventModeLabel: 'イベントカウントダウンモード',
    pricingMetaAdsLabel: 'AI Meta広告エージェント＆自動最適化',
    pricingIncluded: '標準搭載',
    pricingNotIncluded: '非対応',
    workspaceTabs: {
      overview: '1. ホーム＆連携',
      brand_vault: '2. ブランド＆素材',
      studio: '3. 制作スタジオ',
      autonomy: '4. 自動スケジュール',
      meta_ads: '5. AI Meta広告',
    },
    mobileTabs: {
      overview: 'ホーム',
      brand_vault: '素材庫',
      studio: 'スタジオ',
      autonomy: '自動運用',
      meta_ads: 'Meta広告',
    },
  },
  ko: {
    headerBadgePublic: '글로벌 자율형 SNS & Meta 광고 AI SaaS',
    headerSignIn: '로그인',
    headerStartFree: '브랜드 시작하기',
    headerLogout: '로그아웃',
    heroBadge: '글로벌 1위 4대 SNS 자동 제작 & AI Meta Ads 미디어 바이어',
    heroTitlePre: '24시간 릴스·카드뉴스 제작 및 AI Meta 광고 최적화 팀, 월 ',
    heroTitleHighlight: '₩49,000부터',
    heroTitlePost: '',
    heroSubtitle:
      '선호하는 레퍼런스 디자인과 실제 매장·제품·이벤트 사진만 업로드하세요. Veloxa AI가 에이전시급 9:16 릴스, 4:5 캐러셀(카드뉴스), 피드 포스터를 제작하고 무결점 품질 검수 후 인스타그램, 페이스북, 틱톡, 유튜브 쇼츠에 자동 발행하며 매일 Meta 광고 효율을 극대화합니다.',
    heroPrimaryCta: '지금 내 브랜드 자동화 시작하기',
    heroSecondaryCta: '라이브 워크스페이스 체험 →',
    heroTrustPill1: '99/100 자가 복구 퀄리티 게이트',
    heroTrustPill2: '4대 채널 동시 발행 (IG, FB, TikTok, YT)',
    heroTrustPill3: '24/7 AI Meta Ads ROAS 최적화',
    heroTrustPill4: 'Web, Android (.apk) & iOS 네이티브 앱',
    bentoReelsBadge: '9:16 릴스 & 틱톡 + AI 보이스오버',
    bentoCarouselBadge: '4:5 인터랙티브 캐러셀 (4슬라이드)',
    bentoSinglePostBadge: '싱글 피드 포스터 & 광고 소재',
    bentoMetaAdsBadge: 'AI META ADS 미디어 바이어 · ROAS 6.4x',
    galleryEyebrow: '라이브 비주얼 쇼케이스 (릴스 · 캐러셀 · 싱글 포스트)',
    galleryTitle: '글로벌 크리에이티브 에이전시 퀄리티, 당신의 브랜드를 위해 자동 제작됩니다',
    gallerySubtitle:
      '업종 탭을 클릭하여 스타일 DNA와 실제 제품 사진이 결합된 9:16 릴스, 4장 슬라이드 캐러셀, 고효율 싱글 포스터를 직접 확인해보세요.',
    formatReelsTitle: '1. 9:16 세로형 릴스 / 틱톡 / 쇼츠 비디오',
    formatCarouselTitle: '2. 4:5 멀티 슬라이드 스토리텔링 캐러셀',
    formatSingleTitle: '3. 4:5 싱글 피드 포스터 & Meta 광고 소재',
    vaultEyebrow: '듀얼 브랜드 볼트 & 5대 OPENAI 에이전트 아키텍처',
    vaultTitle: 'Veloxa AI는 어떻게 일반 사진을 럭셔리 캠페인으로 바꾸나요?',
    vaultSubtitle:
      '디자인이나 영상 편집 기술이 필요 없습니다. 2단 브랜드 볼트 시스템이 실제 제품 사진에 하이엔드 아트 디렉션을 입혀줍니다.',
    vaultDrawer1Title: '서랍 1 · 스타일 DNA 레퍼런스',
    vaultDrawer1Desc:
      '좋아하는 브랜드의 포스터나 릴스를 업로드하면 비전 AI가 컬러 팔레트, 타이포그래피, 후킹 구조를 추출합니다.',
    vaultDrawer2Title: '서랍 2 · 실제 비즈니스 제품·매장 사진',
    vaultDrawer2Desc:
      '아이폰, 안드로이드, PC에서 촬영한 커피 메뉴, 마라톤 현장, 클리닉 사진을 그대로 업로드하세요.',
    vaultOutputTitle: '결과 · 4개 채널 동시 발행 & 승리 광고 자동 스케일업',
    vaultOutputDesc:
      '5개의 전문 AI 에이전트가 비주얼·캡션·내레이션을 생성하고 품질 검수(88점 이상) 통과 후 자동 게시 및 고효율 Meta 광고에 예산을 집중합니다.',
    nativeEyebrow: '럭셔리 네이티브 모바일 (iOS & ANDROID) + 데스크톱 웹',
    nativeTitle: '스마트폰 하나로 4대 SNS 채널과 Meta 광고를 완벽하게 제어하세요',
    nativeSubtitle:
      '클라우드 비용을 99% 절감하는 Local-First 엔진과 iOS·Android·웹 어디서나 매끄러운 네이티브 UX를 제공합니다.',
    compareTitle: '월간 비용 비교: 기존 마케팅 대행사 vs Veloxa AI',
    compareSubtitle:
      '제작 속도는 10배 빠르게, 매월 마케팅 외주 비용은 최대 85% 절감하세요.',
    compareOldBadge: '기존 방식 (SNS 대행사 + 퍼포먼스 마케터 채용)',
    compareOldPrice: '₩2,000,000 – ₩4,200,000 / 월',
    compareOldBullets: [
      '디자이너, 릴스 영상 편집자, 카피라이터 인건비: 약 ₩1,600,000/월',
      'Meta 광고 대행 수수료: 약 ₩900,000/월 (광고비 별도)',
      '수정에 며칠씩 소요되며 이벤트 타이밍을 놓치기 쉬움',
    ],
    compareNewBadge: '★ Veloxa AI 도입 시 (최대 85% 비용 절감)',
    compareNewPrice: '₩49,000 – ₩139,000 / 월',
    compareNewBullets: [
      '월 20~90개 콘텐츠(9:16 릴스, 4:5 캐러셀, 싱글 포스트) 4개 채널 자동 발행',
      '자가 복구 퀄리티 게이트로 발행 전 오탈자 및 디자인 오류 제로화',
      '24시간 AI Meta Ads 에이전트가 비효율 광고를 끄고 성과 1위 소재에 예산 100% 집중',
    ],
    pricingEyebrow: '투명한 글로벌 요금제',
    pricingTitle: '비즈니스 성장 단계에 맞는 플랜을 선택하세요',
    pricingSubtitle:
      '웹 직접 결제로 앱스토어 수수료 30% 없이 합리적인 가격에 모든 기능을 이용하세요.',
    pricingMostPopular: '인기 플랜',
    pricingStartBtn: '이 플랜으로 시작:',
    pricingQuotaLabel: '월간 콘텐츠 발행 쿼터',
    pricingChannelsLabel: '연동 소셜 채널',
    pricingEventModeLabel: '이벤트 카운트다운 캠페인 모드',
    pricingMetaAdsLabel: 'AI Meta Ads 에이전트 & 자동 최적화',
    pricingIncluded: '포함됨',
    pricingNotIncluded: '미포함',
    workspaceTabs: {
      overview: '1. 홈 & 채널 연동',
      brand_vault: '2. 브랜드 & 볼트',
      studio: '3. 콘텐츠 스튜디오',
      autonomy: '4. 자율 스케줄러',
      meta_ads: '5. AI Meta 광고',
    },
    mobileTabs: {
      overview: '홈',
      brand_vault: '볼트',
      studio: '스튜디오',
      autonomy: '자동화',
      meta_ads: 'Meta 광고',
    },
  },
};
