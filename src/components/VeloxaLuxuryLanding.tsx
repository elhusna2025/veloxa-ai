'use client';

import React, { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe,
  Heart,
  Layers,
  MessageCircle,
  Pause,
  Play,
  Rocket,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  Volume2,
  Zap,
} from 'lucide-react';
import { SUBSCRIPTION_PLANS } from '@/lib/veloxa-engine';
import {
  VELOXA_I18N_COPY,
  VELOXA_LOCALES,
  getPlanLocalizedPrice,
  type VeloxaLocale,
} from '@/lib/veloxa-i18n';
import type { SubscriptionPlanId } from '@/lib/veloxa-types';

interface IndustryShowcaseItem {
  id: 'marathon' | 'cafe' | 'clinic' | 'fashion';
  tabLabel: Record<VeloxaLocale, string>;
  brandName: string;
  handle: string;
  city: string;
  followers: string;
  reel: {
    photoUrl: string;
    duration: string;
    hookBadge: string;
    captionTitle: string;
    voiceoverScript: string;
    audioTrack: string;
    likes: string;
    comments: string;
    shares: string;
    qualityScore: number;
  };
  carousel: {
    title: string;
    slides: Array<{
      slideNumber: number;
      tag: string;
      headline: string;
      subtext: string;
      photoUrl: string;
    }>;
  };
  singlePost: {
    photoUrl: string;
    badge: string;
    headline: string;
    offerPrice: string;
    ctaLabel: string;
    metaAdRoas: string;
    metaAdCpr: string;
    targetAudience: string;
    validatedInterests: string[];
  };
}

const LIVE_GLOBAL_TICKER_ITEMS = [
  {
    badge: '🏃‍♂️ MARATHON REELS 9:16',
    text: 'Nusantara Run Bandung · Published to IG Reels, TikTok & YT Shorts (Score 99/100)',
    metric: '42.8K Views',
  },
  {
    badge: '☕ CAFE CAROUSEL 4:5',
    text: 'Kopi Senja Jakarta · 4-Slide Menu Carousel Auto-Published',
    metric: '5.9x Meta ROAS',
  },
  {
    badge: '✨ CLINIC META ADS AI',
    text: 'GlowDerm Dubai · Loser Variant B Paused, 100% Budget Scaled to Winner A',
    metric: '7.4x ROAS · CPR -43%',
  },
  {
    badge: '👗 FASHION D2C GLOBAL',
    text: 'Atelier Lumière Paris · Lookbook Reels + Catalog Ad Synced',
    metric: '74.3K Likes',
  },
  {
    badge: '🇯🇵 TOKYO ROASTERY',
    text: 'Shibuya Specialty Coffee · AI Voiceover Japanese Reels Live',
    metric: '¥420 / Lead',
  },
  {
    badge: '🇰🇷 SEOUL K-BEAUTY',
    text: 'Gangnam Glass Skin Clinic · 4-Channel Autonomous Schedule Active',
    metric: '99/100 Quality Gate',
  },
];

const INDUSTRY_SHOWCASES: IndustryShowcaseItem[] = [
  {
    id: 'marathon',
    tabLabel: {
      id: '🏃‍♂️ Event Lari & Marathon',
      en: '🏃‍♂️ Marathon & Global Events',
      es: '🏃‍♂️ Maratón y Eventos',
      ar: '🏃‍♂️ الماراثون والفعاليات',
      ja: '🏃‍♂️ マラソン＆イベント',
      ko: '🏃‍♂️ 마라톤 & 글로벌 이벤트',
    },
    brandName: 'Nusantara Run Festival',
    handle: '@nusantararun.id',
    city: 'Bandung · Tokyo · Berlin',
    followers: '48.9K',
    reel: {
      photoUrl:
        'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=900&q=85',
      duration: '0:18',
      hookBadge: 'H-14 COUNTDOWN · SLOT TERSISA 12%',
      captionTitle: 'Detik-Detik Sunrise 10K & Half Marathon 21K · Finisher Jersey & Medal Reveal!',
      voiceoverScript:
        '“Siap pecahkan Personal Best kamu? Tinggal 14 hari menuju garis start! Amankan slot terakhir sebelum Sold Out malam ini.”',
      audioTrack: 'Veloxa AI Voiceover · Energetic Runner Beat (128 BPM)',
      likes: '42.8K',
      comments: '1,940',
      shares: '8,410',
      qualityScore: 99,
    },
    carousel: {
      title: '4-Slide Interactive Race Pack & Route Guide (4:5)',
      slides: [
        {
          slideNumber: 1,
          tag: 'SLIDE 1/4 · COVER HOOK',
          headline: '4 Alasan Ribuan Pelari Wajib Ikut Sunrise Half Marathon 2026',
          subtext: 'Geser untuk lihat rute steril, medali zinc-alloy 3D, & titik cheering terbaik →',
          photoUrl:
            'https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 2,
          tag: 'SLIDE 2/4 · ELEVATION & ROUTE',
          headline: 'Rute Heritage Steril & Flat · Potensi Pecah Rekor Personal Best!',
          subtext: 'Water station tiap 2.5 KM dengan isotonic dingin, energy gel, dan tim medis siaga.',
          photoUrl:
            'https://images.unsplash.com/photo-1513593771513-7b58b6c4af38?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 3,
          tag: 'SLIDE 3/4 · RACE PACK EXCLUSIVE',
          headline: 'Ultra-Light DryFit Jersey + 3D Finisher Medal Berkilau',
          subtext: 'Desain eksklusif hasil ekstraksi Style DNA dari event marathon kelas dunia.',
          photoUrl:
            'https://images.unsplash.com/photo-1571008887538-b36bb32f4571?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 4,
          tag: 'SLIDE 4/4 · CALL TO ACTION',
          headline: 'Amankan Slot Early Bird Sebelum Kuota Ditutup Malam Ini!',
          subtext: 'Klik link registrasi di bio atau tombol WhatsApp untuk klaim diskon komunitas 15%.',
          photoUrl:
            'https://images.unsplash.com/photo-1530549387789-4c1017266635?auto=format&fit=crop&w=900&q=80',
        },
      ],
    },
    singlePost: {
      photoUrl:
        'https://images.unsplash.com/photo-1486218119243-13883505764c?auto=format&fit=crop&w=900&q=80',
      badge: 'SINGLE POSTER 4:5 · WINNER META AD CREATIVE',
      headline: 'Early Bird 10K & 21K Resmi Dibuka · Gratis Ukiran Nama di Medali!',
      offerPrice: 'Rp225.000 / $19 Race Slot',
      ctaLabel: 'Daftar Sekarang via WhatsApp / Web →',
      metaAdRoas: '6.8x ROAS',
      metaAdCpr: 'Rp8.400 / Registrasi',
      targetAudience: 'Usia 19–44 · Radius +25km · Running & Fitness',
      validatedInterests: ['Marathon (#600312)', 'Garmin Running (#600891)', 'Strava Community (#600442)'],
    },
  },
  {
    id: 'cafe',
    tabLabel: {
      id: '☕ Specialty Cafe & Roastery',
      en: '☕ Specialty Cafe & F&B',
      es: '☕ Cafetería y Gastronomía',
      ar: '☕ المقاهي والمطاعم المختصة',
      ja: '☕ スペシャルティカフェ＆飲食',
      ko: '☕ 스페셜티 카페 & F&B',
    },
    brandName: 'Kopi Senja Artisan Roastery',
    handle: '@kopisenja.roastery',
    city: 'Jakarta · Singapore · Seoul',
    followers: '64.2K',
    reel: {
      photoUrl:
        'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=85',
      duration: '0:15',
      hookBadge: 'GOLDEN HOUR PROMO · BUY 2 GET 3',
      captionTitle: 'Rahasia Creamy Butterscotch Sea Salt Latte yang Bikin Ketagihan!',
      voiceoverScript:
        '“Double shot espresso Arabika Gayo berpadu dengan saus butterscotch panggang dan sea salt foam lembut. Sore ini beli 2 gratis 1!”',
      audioTrack: 'Veloxa AI Voiceover · Warm Acoustic Cafe Lo-Fi',
      likes: '56.1K',
      comments: '2,410',
      shares: '11.2K',
      qualityScore: 98,
    },
    carousel: {
      title: '4-Slide Signature Menu & Roastery Story (4:5)',
      slides: [
        {
          slideNumber: 1,
          tag: 'SLIDE 1/4 · VISUAL CRAVING HOOK',
          headline: '3 Menu Signature Baru yang Wajib Kamu Coba Minggu Ini',
          subtext: 'Disangrai segar setiap pagi dengan biji 100% Specialty Arabica pilihan →',
          photoUrl:
            'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 2,
          tag: 'SLIDE 2/4 · BEST SELLER #1',
          headline: 'Iced Butterscotch Sea Salt Latte · Gurih, Creamy, & Bold',
          subtext: 'Perpaduan sempurna untuk menemani kerja WFC atau nongkrong sore.',
          photoUrl:
            'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 3,
          tag: 'SLIDE 3/4 · ARTISAN PASTRY PAIRING',
          headline: 'Almond Kouign-Amann & Pain au Chocolat Hangat dari Oven',
          subtext: 'Lapisan butter Prancis renyah di luar dan lembut lumer di dalam.',
          photoUrl:
            'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 4,
          tag: 'SLIDE 4/4 · PROMO BUNDLING',
          headline: 'Paket Bundling Ngopi Berdua + Croissant Hanya Rp65.000',
          subtext: 'Klaim voucher langsung lewat WhatsApp atau tunjukkan postingan ini di kasir!',
          photoUrl:
            'https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&w=900&q=80',
        },
      ],
    },
    singlePost: {
      photoUrl:
        'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=900&q=80',
      badge: 'SINGLE POSTER 4:5 · LOCAL RADIUS META AD',
      headline: 'Paket WFC Hemat: Signature Latte + Artisan Croissant Mulai Rp45rb!',
      offerPrice: 'Rp45.000 / $4.50 Combo',
      ctaLabel: 'Klaim Voucher & Pesan Sekarang →',
      metaAdRoas: '5.9x ROAS',
      metaAdCpr: 'Rp4.200 / Klaim Voucher',
      targetAudience: 'Usia 18–38 · Radius +8km sekitar Outlet · Coffee Lovers',
      validatedInterests: ['Specialty Coffee (#601102)', 'Cafe & Bakery (#601488)', 'Remote Work (#601920)'],
    },
  },
  {
    id: 'clinic',
    tabLabel: {
      id: '✨ Klinik Estetika & Kecantikan',
      en: '✨ Aesthetic & Wellness Clinic',
      es: '✨ Clínica Estética y Belleza',
      ar: '✨ عيادات التجميل والعناية',
      ja: '✨ 美容クリニック＆ウェルネス',
      ko: '✨ 에스테틱 & 뷰티 클리닉',
    },
    brandName: 'GlowDerm Aesthetic Clinic',
    handle: '@glowderm.clinic',
    city: 'Surabaya · Dubai · Beverly Hills',
    followers: '81.5K',
    reel: {
      photoUrl:
        'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=900&q=85',
      duration: '0:21',
      hookBadge: 'GLASS SKIN PICO LASER · 0 DOWNTIME',
      captionTitle: 'Transformasi Wajah Cerah & Pori Halus dalam 20 Menit Bersama Dokter Spesialis!',
      voiceoverScript:
        '“Kulit kusam dan noda bekas jerawat membandel? Lihat hasil nyata Korean Glass Skin Pico Laser kami tanpa rasa perih dan langsung glowing!”',
      audioTrack: 'Veloxa AI Voiceover · Luxury Clean Spa Ambience',
      likes: '38.4K',
      comments: '1,620',
      shares: '6,890',
      qualityScore: 99,
    },
    carousel: {
      title: '4-Slide Doctor Education & Treatment Breakdown (4:5)',
      slides: [
        {
          slideNumber: 1,
          tag: 'SLIDE 1/4 · DERMATOLOGY HOOK',
          headline: 'Kenapa Skincare Saja Kadang Belum Cukup Menghilangkan Flek Hitam?',
          subtext: 'Penjelasan medis ringan dari tim dokter estetika GlowDerm →',
          photoUrl:
            'https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 2,
          tag: 'SLIDE 2/4 · TECHNOLOGY',
          headline: 'Teknologi Picosecond Laser: Memecah Pigmen Tanpa Merusak Kulit',
          subtext: 'Aman untuk semua jenis kulit Asia dengan waktu pemulihan instan (0 downtime).',
          photoUrl:
            'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 3,
          tag: 'SLIDE 3/4 · REAL CLINICAL PROTOCOL',
          headline: '3 Tahap Glow Up: Skin Analyzer 3D → Pico Laser → Soothing Collagen Mask',
          subtext: 'Seluruh prosedur ditangani langsung oleh dokter tersertifikasi resmi.',
          photoUrl:
            'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 4,
          tag: 'SLIDE 4/4 · VIP BOOKING CTA',
          headline: 'Hemat 30% untuk Sesi Pertama + Gratis Analisa Kulit 3D!',
          subtext: 'Reservasi jadwal konsultasi privat Anda melalui WhatsApp Concierge kami.',
          photoUrl:
            'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=900&q=80',
        },
      ],
    },
    singlePost: {
      photoUrl:
        'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=80',
      badge: 'SINGLE POSTER 4:5 · HIGH-TICKET LEAD AD',
      headline: 'Korean Glass Skin Laser Package · Diskon 30% Khusus 25 Reservasi Hari Ini',
      offerPrice: 'Rp499.000 / $45 First Trial',
      ctaLabel: 'Booking Konsultasi Dokter via WhatsApp →',
      metaAdRoas: '7.4x ROAS',
      metaAdCpr: 'Rp14.500 / Pasien Baru',
      targetAudience: 'Wanita & Pria 22–48 · Radius +15km · Skincare & Beauty',
      validatedInterests: ['Skin Care (#600291)', 'Medical Spa (#600774)', 'K-Beauty Glow (#600983)'],
    },
  },
  {
    id: 'fashion',
    tabLabel: {
      id: '👗 Fashion & Global E-Commerce',
      en: '👗 Fashion & Global D2C Brands',
      es: '👗 Moda y E-Commerce Global',
      ar: '👗 الأزياء والتجارة الإلكترونية',
      ja: '👗 ファッション＆D2C ECブランド',
      ko: '👗 패션 & 글로벌 D2C 브랜드',
    },
    brandName: 'Atelier Lumière Minimalist Wear',
    handle: '@atelierlumiere.co',
    city: 'Paris · Milan · Bali · New York',
    followers: '112.4K',
    reel: {
      photoUrl:
        'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=85',
      duration: '0:16',
      hookBadge: 'NEW RESORT CAPSULE · LIMITED DROP',
      captionTitle: '3 Cara Styling Linen Tailored Blazer dari Meeting Pagi ke Dinner Mewah',
      voiceoverScript:
        '“Satu koleksi, tiga karakter elegan. Dibuat dari 100% organic French linen yang adem dan jatuh sempurna di badan.”',
      audioTrack: 'Veloxa AI Voiceover · Parisian Runway House Beat',
      likes: '74.3K',
      comments: '3,120',
      shares: '14.9K',
      qualityScore: 99,
    },
    carousel: {
      title: '4-Slide Editorial Lookbook & Fabric Close-Up (4:5)',
      slides: [
        {
          slideNumber: 1,
          tag: 'SLIDE 1/4 · EDITORIAL LOOKBOOK',
          headline: 'The Monochrome Linen Capsule 2026 · Timeless Luxury',
          subtext: 'Dirancang untuk siluet tegas namun tetap ringan sepanjang hari →',
          photoUrl:
            'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 2,
          tag: 'SLIDE 2/4 · CRAFTSMANSHIP',
          headline: 'Jahitan Tailored Presisi & Kancing Mother-of-Pearl Asli',
          subtext: 'Detail kemewahan yang terlihat jelas bahkan dari jarak dekat.',
          photoUrl:
            'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 3,
          tag: 'SLIDE 3/4 · DAY-TO-NIGHT STYLING',
          headline: 'Padukan dengan Pleated Trousers atau Silk Slip Dress',
          subtext: 'Tersedia dalam warna Ivory White, Espresso, dan Soft Rose.',
          photoUrl:
            'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=900&q=80',
        },
        {
          slideNumber: 4,
          tag: 'SLIDE 4/4 · WORLDWIDE EXPRESS',
          headline: 'Pengiriman Ekspres ke Seluruh Dunia · Stok Terbatas 200 Pcs',
          subtext: 'Belanja langsung via Website atau WhatsApp VIP Personal Shopper.',
          photoUrl:
            'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=900&q=80',
        },
      ],
    },
    singlePost: {
      photoUrl:
        'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=900&q=80',
      badge: 'SINGLE POSTER 4:5 · CATALOG CONVERSION AD',
      headline: 'The Ivory Linen Set · Free Worldwide Express Shipping Hari Ini',
      offerPrice: 'Rp689.000 / $59 Complete Set',
      ctaLabel: 'Shop Collection Now →',
      metaAdRoas: '6.2x ROAS',
      metaAdCpr: 'Rp19.200 / Purchase',
      targetAudience: 'Usia 21–45 · Global Tier-1 Cities · Luxury & Minimalist Fashion',
      validatedInterests: ['Luxury Fashion (#602110)', 'Minimalist Style (#602334)', 'Online Shopping (#602890)'],
    },
  },
];

const FOOTER_COPY: Record<
  VeloxaLocale,
  {
    ctaBannerTitle: string;
    ctaBannerSubtitle: string;
    ctaBannerPrimary: string;
    ctaBannerSecondary: string;
    brandDesc: string;
    uptimeBadge: string;
    colStudio: string;
    colChannels: string;
    colArchitecture: string;
    colGlobal: string;
    copyright: string;
    motionPlayingLabel: string;
    motionPausedLabel: string;
  }
> = {
  id: {
    ctaBannerTitle: 'Siap Mengotomatiskan 4 Sosial Media & Meta Ads Bisnis Anda Hari Ini?',
    ctaBannerSubtitle:
      'Bergabunglah dengan ratusan pemilik brand, EO marathon, cafe, klinik, dan e-commerce global yang menghemat hingga 85% biaya agensi setiap bulan.',
    ctaBannerPrimary: 'Daftarkan Bisnis Anda Sekarang',
    ctaBannerSecondary: 'Masuk ke Live Demo Workspace →',
    brandDesc:
      'Platform SaaS Multi-Tenant Global untuk produksi otonom Reels 9:16, Carousel 4:5, & Single Poster di 4 kanal sosial media sekaligus, dilengkapi AI Agent Meta Ads 24/7.',
    uptimeBadge: '● 5 Agen OpenAI & 4 API Sosmed Aktif Normal (99.98% Uptime)',
    colStudio: 'Studio AI & Brand Vault',
    colChannels: 'Otonomi 4 Kanal & Meta Ads',
    colArchitecture: 'Aplikasi Native & Cloud',
    colGlobal: 'Pasar & Mata Uang Global',
    copyright: '© 2026 Veloxa AI Inc. · PT Veloxa Kreasi AI Global. Seluruh hak cipta dilindungi.',
    motionPlayingLabel: 'Animasi Hidup: Aktif',
    motionPausedLabel: 'Animasi: Dijeda',
  },
  en: {
    ctaBannerTitle: 'Ready to Automate Your 4 Social Channels & Meta Ads Today?',
    ctaBannerSubtitle:
      'Join fast-growing event organizers, specialty cafes, aesthetic clinics, and global D2C brands saving up to 85% on monthly agency retainers.',
    ctaBannerPrimary: 'Launch Your Brand Now',
    ctaBannerSecondary: 'Open Live Workspace Demo →',
    brandDesc:
      'Global Multi-Tenant SaaS Platform for autonomous 9:16 Reels, 4:5 Carousels, and Single Feed Posts across 4 social channels, powered by a 24/7 AI Meta Ads Media Buyer.',
    uptimeBadge: '● All 5 OpenAI Agents & 4 Social APIs Operational (99.98% Uptime)',
    colStudio: 'AI Studio & Brand Vault',
    colChannels: '4-Channel & Meta Ads AI',
    colArchitecture: 'Native Apps & Cloud Engine',
    colGlobal: 'Global Markets & Currency',
    copyright: '© 2026 Veloxa AI Inc. · Global Autonomous Marketing Cloud. All rights reserved.',
    motionPlayingLabel: 'Live Motion: On',
    motionPausedLabel: 'Live Motion: Paused',
  },
  es: {
    ctaBannerTitle: '¿Listo para Automatizar Tus 4 Redes Sociales y Meta Ads Hoy Mismo?',
    ctaBannerSubtitle:
      'Únete a marcas globales, cafeterías, clínicas y eventos que ahorran hasta un 85% mensual en agencias tradicionales.',
    ctaBannerPrimary: 'Registrar Mi Marca Ahora',
    ctaBannerSecondary: 'Abrir Demo en Vivo →',
    brandDesc:
      'Plataforma SaaS Global para la producción autónoma de Reels 9:16, Carruseles 4:5 y Posts en 4 redes sociales con optimización Meta Ads 24/7.',
    uptimeBadge: '● 5 Agentes OpenAI y 4 APIs Sociales Operativos (99.98% Uptime)',
    colStudio: 'Estudio IA y Brand Vault',
    colChannels: '4 Redes y Meta Ads IA',
    colArchitecture: 'Apps Nativas y Cloud',
    colGlobal: 'Mercados y Divisas Globales',
    copyright: '© 2026 Veloxa AI Inc. · Todos los derechos reservados.',
    motionPlayingLabel: 'Animación: Activa',
    motionPausedLabel: 'Animación: Pausada',
  },
  ar: {
    ctaBannerTitle: 'هل أنت مستعد لأتمتة قنواتك الأربع وحملات Meta Ads اليوم؟',
    ctaBannerSubtitle:
      'انضم إلى العلامات التجارية العالمية والمقاهي والعيادات التي توفر حتى 85% من تكاليف الوكالات شهرياً.',
    ctaBannerPrimary: 'ابدأ بتسجيل علامتك الآن',
    ctaBannerSecondary: 'افتح لوحة التحكم الحية ←',
    brandDesc:
      'منصة سحابية عالمية لإنتاج فيديوهات الريلز 9:16 والكاروسيل 4:5 تلقائياً عبر 4 منصات مع وكيل ذكي لإدارة إعلانات ميتا على مدار الساعة.',
    uptimeBadge: '● جميع وكلاء الذكاء الاصطناعي وواجهات المنصات تعمل بكفاءة (99.98%)',
    colStudio: 'استوديو الذكاء والخزنة',
    colChannels: 'النشر التلقائي وإعلانات ميتا',
    colArchitecture: 'تطبيقات الهواتف والسحابة',
    colGlobal: 'الأسواق والعملات العالمية',
    copyright: '© 2026 Veloxa AI Inc. جميع الحقوق محفوظة.',
    motionPlayingLabel: 'الحركة التفاعلية: نشطة',
    motionPausedLabel: 'الحركة: متوقفة',
  },
  ja: {
    ctaBannerTitle: '4大SNSの自動制作＆Meta広告のAI最適化を今すぐ始めませんか？',
    ctaBannerSubtitle:
      '毎月の外注コストを最大85%削減しながら、エージェンシー品質のリール・カルーセルを自動発信。',
    ctaBannerPrimary: '今すぐブランドを登録する',
    ctaBannerSecondary: 'ライブワークスペースを体験 →',
    brandDesc:
      '9:16リール、4:5カルーセル、フィード投稿の自動生成から4大SNS同時公開、24時間AI Meta広告運用までを統合したグローバルSaaSプラットフォーム。',
    uptimeBadge: '● 全5つのOpenAIエージェント＆4大SNS API正常稼働中 (稼働率 99.98%)',
    colStudio: 'AIスタジオ＆ブランド素材庫',
    colChannels: '4チャネル自動公開＆Meta広告',
    colArchitecture: 'ネイティブアプリ＆クラウド基盤',
    colGlobal: 'グローバル言語＆通貨設定',
    copyright: '© 2026 Veloxa AI Inc. All rights reserved.',
    motionPlayingLabel: 'ライブアニメーション: ON',
    motionPausedLabel: 'アニメーション: 一時停止',
  },
  ko: {
    ctaBannerTitle: '오늘 바로 4대 SNS 채널 자동화 및 AI Meta 광고 최적화를 시작하세요',
    ctaBannerSubtitle:
      '매월 에이전시 외주 비용을 최대 85% 절감하며 하이엔드 릴스와 캐러셀을 자동으로 발행하세요.',
    ctaBannerPrimary: '지금 브랜드 시작하기',
    ctaBannerSecondary: '라이브 워크스페이스 체험 →',
    brandDesc:
      '9:16 릴스, 4:5 캐러셀, 싱글 포스터 자동 제작부터 4대 SNS 동시 발행 및 24/7 AI Meta Ads 미디어 바이어를 통합한 글로벌 SaaS 플랫폼.',
    uptimeBadge: '● 5대 OpenAI 에이전트 및 4대 소셜 API 정상 가동 중 (99.98% Uptime)',
    colStudio: 'AI 스튜디오 & 브랜드 볼트',
    colChannels: '4채널 자동 발행 & Meta 광고',
    colArchitecture: '네이티브 앱 & 로컬퍼스트 엔진',
    colGlobal: '글로벌 언어 & 통화 선택',
    copyright: '© 2026 Veloxa AI Inc. All rights reserved.',
    motionPlayingLabel: '라이브 모션: 켜짐',
    motionPausedLabel: '라이브 모션: 일시정지',
  },
};

function createFallbackSvg(title: string, subtitle: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#171717"/>
        <stop offset="55%" stop-color="#262626"/>
        <stop offset="100%" stop-color="#EC749B"/>
      </linearGradient>
    </defs>
    <rect width="720" height="900" fill="url(#g)"/>
    <circle cx="580" cy="180" r="180" fill="#EC749B" fill-opacity="0.22"/>
    <rect x="48" y="620" width="624" height="210" rx="28" fill="#FFFFFF" fill-opacity="0.95"/>
    <text x="80" y="685" font-family="system-ui, sans-serif" font-size="22" font-weight="800" fill="#EC749B">${subtitle.replace(/[<>&"']/g, '')}</text>
    <text x="80" y="740" font-family="system-ui, sans-serif" font-size="30" font-weight="900" fill="#171717">${title.slice(0, 36).replace(/[<>&"']/g, '')}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface VeloxaLuxuryLandingProps {
  locale: VeloxaLocale;
  onSelectLocale: (locale: VeloxaLocale) => void;
  onOpenOnboarding: (defaultPlanId?: SubscriptionPlanId) => void;
  onOpenAuthModal: () => void;
}

export function VeloxaLuxuryLanding({
  locale,
  onSelectLocale,
  onOpenOnboarding,
  onOpenAuthModal,
}: VeloxaLuxuryLandingProps) {
  const copy = VELOXA_I18N_COPY[locale];
  const footerCopy = FOOTER_COPY[locale];
  const localeMeta = VELOXA_LOCALES.find((l) => l.code === locale) || VELOXA_LOCALES[0];

  // Interactive state for Hero Carousel, Industry Gallery, and Kinetic Motion Pause/Play
  const [heroCarouselIndex, setHeroCarouselIndex] = useState<number>(0);
  const [activeIndustryId, setActiveIndustryId] = useState<IndustryShowcaseItem['id']>('marathon');
  const [galleryCarouselIndex, setGalleryCarouselIndex] = useState<number>(0);
  const [isMotionActive, setIsMotionActive] = useState<boolean>(true);

  const activeIndustry =
    INDUSTRY_SHOWCASES.find((item) => item.id === activeIndustryId) || INDUSTRY_SHOWCASES[0];
  const heroIndustry = INDUSTRY_SHOWCASES[0];
  const heroCurrentSlide =
    heroIndustry.carousel.slides[heroCarouselIndex % heroIndustry.carousel.slides.length];
  const galleryCurrentSlide =
    activeIndustry.carousel.slides[galleryCarouselIndex % activeIndustry.carousel.slides.length];

  // Auto-cycle Hero 4:5 Carousel slides every 3.5 seconds when live motion is active
  useEffect(() => {
    if (!isMotionActive) return;
    const timer = window.setInterval(() => {
      setHeroCarouselIndex((prev) => (prev + 1) % heroIndustry.carousel.slides.length);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [isMotionActive, heroIndustry.carousel.slides.length]);

  return (
    <div
      dir={localeMeta.dir}
      className={`space-y-12 bg-white pb-10 ${isMotionActive ? 'veloxa-motion-active' : ''}`}
      data-testid="veloxa-sales-landing-page"
    >
      {/* ============================================================================
         SECTION 1: ULTRA-LUXURY GLOBAL HERO + LIVE REELS, CAROUSEL & META ADS BENTO
         100% Pure Clean White (#FFFFFF) + Strong Luxury Card Shadows + 10% Soft Pink (#EC749B)
         ============================================================================ */}
      <section className="veloxa-luxury-section relative overflow-hidden rounded-[2rem] border border-neutral-200/90 bg-white p-6 sm:p-10 lg:p-12">
        {/* Top Global Language, Currency & Motion Control Bar inside Hero */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-pink-200 bg-pink-50/80 px-3.5 py-1.5 text-xs font-black text-[#D85A88]">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#EC749B]" />
              <span className="veloxa-trim-text">{copy.heroBadge}</span>
            </div>

            {/* Accessible Pause/Play Mechanism for Kinetic Animations (modern-web-guidance: motion) */}
            <button
              type="button"
              data-testid="toggle-kinetic-motion-btn"
              onClick={() => setIsMotionActive((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] font-bold text-neutral-700 shadow-xs transition hover:border-pink-200 hover:text-[#D85A88]"
            >
              {isMotionActive ? (
                <>
                  <Pause className="h-3 w-3 text-[#EC749B]" />
                  <span>{footerCopy.motionPlayingLabel}</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 text-neutral-500" />
                  <span>{footerCopy.motionPausedLabel}</span>
                </>
              )}
            </button>
          </div>

          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Global Language and Market Switcher"
          >
            <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-bold text-neutral-500">
              <Globe className="h-3.5 w-3.5 text-[#EC749B]" />
              Global Market:
            </span>
            {VELOXA_LOCALES.map((item) => {
              const isSelected = item.code === locale;
              return (
                <button
                  key={item.code}
                  type="button"
                  data-testid={`landing-lang-btn-${item.code}`}
                  onClick={() => onSelectLocale(item.code)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                    isSelected
                      ? 'bg-[#EC749B] text-white shadow-sm'
                      : 'border border-neutral-200 bg-white text-neutral-700 shadow-2xs hover:border-pink-200 hover:text-[#D85A88]'
                  }`}
                >
                  <span>{item.flag}</span>
                  <span>{item.code.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Hero Grid: Left Editorial Pitch + Right Live Animated Social Visual Studio */}
        <div className="grid items-center gap-10 lg:grid-cols-[1.03fr_0.97fr]">
          {/* Left Column: High-Converting Luxury Copy & Trust Signals */}
          <div className="text-left">
            <h1 className="text-3xl font-black leading-[1.12] tracking-tight text-neutral-900 sm:text-5xl">
              {copy.heroTitlePre}
              <span className="inline-block rounded-2xl border border-pink-200 bg-pink-50/70 px-3 py-0.5 text-[#EC749B] shadow-xs">
                {copy.heroTitleHighlight}
              </span>
              {copy.heroTitlePost}
            </h1>

            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-neutral-600 sm:text-base">
              {copy.heroSubtitle}
            </p>

            {/* Primary & Secondary CTAs */}
            <div className="mt-7 flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                data-testid="landing-cta-start-btn"
                onClick={() => onOpenOnboarding('pro_1500k')}
                className="veloxa-luxury-card-pink inline-flex items-center gap-2 rounded-2xl bg-[#EC749B] px-6 py-4 text-sm font-black text-white transition hover:bg-[#DF608A]"
              >
                <Rocket className="h-4 w-4 shrink-0" />
                <span className="veloxa-trim-text">{copy.heroPrimaryCta}</span>
              </button>

              <button
                type="button"
                data-testid="landing-open-login-btn"
                onClick={onOpenAuthModal}
                className="veloxa-luxury-card inline-flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-6 py-4 text-sm font-bold text-neutral-800 transition hover:border-pink-200 hover:text-[#D85A88]"
              >
                <span className="veloxa-trim-text">{copy.heroSecondaryCta}</span>
              </button>
            </div>

            {/* 4 Trust Pills */}
            <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                copy.heroTrustPill1,
                copy.heroTrustPill2,
                copy.heroTrustPill3,
                copy.heroTrustPill4,
              ].map((pill) => (
                <div
                  key={pill}
                  className="veloxa-luxury-card flex items-center gap-2 rounded-xl border border-neutral-200/90 bg-white px-3.5 py-3 text-xs font-bold text-neutral-800"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#EC749B]" />
                  <span className="truncate">{pill}</span>
                </div>
              ))}
            </div>

            {/* Supported Global Platforms Strip */}
            <div className="veloxa-luxury-card mt-7 rounded-2xl border border-neutral-200/90 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
                  4-Channel Official OAuth + Meta Marketing API
                </span>
                <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
                  ✓ Zero API Key Setup For Users
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  'Instagram Reels & Feed',
                  'Facebook Page & Reels',
                  'TikTok Video & Photo Mode',
                  'YouTube Shorts (9:16)',
                  'Meta Ads Manager AI',
                ].map((ch) => (
                  <span
                    key={ch}
                    className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-bold text-neutral-800 shadow-xs"
                  >
                    {ch}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Kinetic Animated Visual Showcase (Floating 9:16 Reels Phone + Auto-Cycling 4:5 Carousel + Meta Ads ROAS Card) */}
          <div className="grid gap-5 sm:grid-cols-[0.95fr_1.05fr]">
            {/* Visual Card A: Floating 9:16 Instagram/TikTok Vertical Reels Phone with Ken Burns Video Motion & Dancing Audio Equalizer */}
            <div className="veloxa-float-slow relative flex flex-col justify-between overflow-hidden rounded-[2rem] border-2 border-neutral-900 bg-neutral-900 p-3 text-white shadow-2xl">
              {/* Top Phone Speaker & Live Badge */}
              <div className="relative z-10 flex items-center justify-between gap-1 px-1 pt-1">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-black text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  REELS 9:16 LIVE
                </span>
                <span className="rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                  ✓ Score {heroIndustry.reel.qualityScore}/100
                </span>
              </div>

              {/* Main 9:16 Vertical Video Frame Image (LCP Image -> fetchpriority="high" + Ken Burns Slow Motion) */}
              <div className="relative my-2.5 aspect-[9/14] w-full overflow-hidden rounded-2xl bg-neutral-800">
                <img
                  src={heroIndustry.reel.photoUrl}
                  alt={heroIndustry.reel.captionTitle}
                  fetchPriority="high"
                  width={540}
                  height={840}
                  onError={(e) => {
                    e.currentTarget.src = createFallbackSvg(
                      heroIndustry.reel.captionTitle,
                      heroIndustry.reel.hookBadge,
                    );
                  }}
                  className="veloxa-ken-burns h-full w-full object-cover"
                />
                {/* Dark Gradient Overlay for Crisp Readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/30" />

                {/* Top Author Header Inside Reel */}
                <div className="absolute inset-x-3 top-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#EC749B] text-[11px] font-black text-white">
                      NR
                    </div>
                    <div>
                      <p className="text-[11px] font-black leading-none text-white">
                        {heroIndustry.handle}
                      </p>
                      <p className="text-[9px] text-white/80">IG Reels · TikTok · Shorts</p>
                    </div>
                  </div>
                  <span className="rounded-full border border-white/30 bg-white/15 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur">
                    {heroIndustry.reel.duration}
                  </span>
                </div>

                {/* Center Pulsing Play Button & Hook Overlay Pill */}
                <div className="absolute inset-x-3 top-1/3 flex flex-col items-center text-center">
                  <div className="veloxa-live-ping relative mb-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-[#EC749B]/95 text-white shadow-lg">
                    <Play className="h-5 w-5 fill-current" />
                  </div>
                  <span className="rounded-xl border border-pink-300/60 bg-black/75 px-3 py-1 text-[10px] font-black tracking-wide text-pink-200 backdrop-blur">
                    {heroIndustry.reel.hookBadge}
                  </span>
                </div>

                {/* Right Vertical Engagement Column (Like, Comment, Share) */}
                <div className="absolute bottom-24 right-2.5 flex flex-col items-center gap-3 text-[10px] font-bold text-white">
                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur">
                      <Heart className="h-4 w-4 fill-[#EC749B] text-[#EC749B]" />
                    </div>
                    <span className="mt-0.5">{heroIndustry.reel.likes}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur">
                      <MessageCircle className="h-4 w-4 text-white" />
                    </div>
                    <span className="mt-0.5">{heroIndustry.reel.comments}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur">
                      <Send className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="mt-0.5">{heroIndustry.reel.shares}</span>
                  </div>
                </div>

                {/* Bottom Caption & Dancing AI Voiceover Equalizer Waveform inside Reel */}
                <div className="absolute inset-x-3 bottom-3 space-y-2 text-left">
                  <p className="line-clamp-2 text-xs font-black leading-snug text-white">
                    {heroIndustry.reel.captionTitle}
                  </p>

                  {/* Live Dancing Equalizer Bars + Audio Track */}
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-white/15 px-2.5 py-1.5 text-[10px] font-semibold text-white backdrop-blur">
                    <div className="flex items-center gap-1.5 truncate">
                      <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#EC749B]" />
                      <span className="truncate">{heroIndustry.reel.audioTrack}</span>
                    </div>
                    <div className="flex h-3.5 shrink-0 items-end gap-0.5" aria-hidden="true">
                      {[0, 1, 2, 3, 4, 5].map((barIdx) => (
                        <span
                          key={barIdx}
                          className="veloxa-eq-bar w-0.5 rounded-full bg-[#EC749B]"
                          style={{
                            height: `${10 + (barIdx % 3) * 3}px`,
                            animationDelay: `${barIdx * 0.12}s`,
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Animated Video Scrubber Timeline Bar */}
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/25">
                    <div className="veloxa-reel-progress h-full w-full rounded-full bg-[#EC749B]" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between px-1 text-[10px] text-neutral-300">
                <span>✓ Auto-Subtitles & Voiceover</span>
                <span className="font-bold text-[#EC749B]">4 Channels Synced</span>
              </div>
            </div>

            {/* Visual Card B: Floating Auto-Playing 4:5 Multi-Slide Carousel + AI Meta Ads ROAS Card */}
            <div className="veloxa-float-delayed flex flex-col justify-between gap-5">
              {/* Auto-Cycling 4:5 Carousel Preview Card */}
              <div className="veloxa-luxury-card rounded-[1.75rem] border border-neutral-200/90 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full border border-pink-200 bg-pink-50/80 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
                    {copy.bentoCarouselBadge}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Previous Carousel Slide"
                      data-testid="hero-carousel-prev-btn"
                      onClick={() =>
                        setHeroCarouselIndex((prev) =>
                          prev === 0 ? heroIndustry.carousel.slides.length - 1 : prev - 1,
                        )
                      }
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-[11px] font-black text-neutral-700">
                      {heroCurrentSlide.slideNumber}/{heroIndustry.carousel.slides.length}
                    </span>
                    <button
                      type="button"
                      aria-label="Next Carousel Slide"
                      data-testid="hero-carousel-next-btn"
                      onClick={() =>
                        setHeroCarouselIndex(
                          (prev) => (prev + 1) % heroIndustry.carousel.slides.length,
                        )
                      }
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* 4:5 Carousel Visual Slide with Auto-Slide Progress Bar */}
                <div className="relative mt-3 aspect-[4/3] w-full overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-900 shadow-md">
                  <img
                    src={heroCurrentSlide.photoUrl}
                    alt={heroCurrentSlide.headline}
                    width={600}
                    height={450}
                    onError={(e) => {
                      e.currentTarget.src = createFallbackSvg(
                        heroCurrentSlide.headline,
                        heroCurrentSlide.tag,
                      );
                    }}
                    className="veloxa-ken-burns h-full w-full object-cover transition duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                  <div className="absolute inset-x-3.5 bottom-3 text-left text-white">
                    <span className="inline-block rounded-md bg-[#EC749B] px-2 py-0.5 text-[9px] font-black uppercase text-white">
                      {heroCurrentSlide.tag}
                    </span>
                    <p className="mt-1 text-xs font-black leading-snug text-white sm:text-sm">
                      {heroCurrentSlide.headline}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-white/85">
                      {heroCurrentSlide.subtext}
                    </p>
                  </div>
                </div>

                {/* Interactive Slide Dots + Auto-Slide Status */}
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {heroIndustry.carousel.slides.map((sl, idx) => (
                      <button
                        key={sl.slideNumber}
                        type="button"
                        onClick={() => setHeroCarouselIndex(idx)}
                        className={`h-2 rounded-full transition-all ${
                          idx === heroCarouselIndex
                            ? 'w-7 bg-[#EC749B]'
                            : 'w-2 bg-neutral-200 hover:bg-pink-200'
                        }`}
                        aria-label={`Slide ${sl.slideNumber}`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] font-bold text-[#D85A88]">
                    {isMotionActive ? '● Auto-Sliding 4 Slides →' : 'Klik panah untuk geser →'}
                  </span>
                </div>
              </div>

              {/* Live AI Meta Ads Media Buyer Telemetry Card */}
              <div className="veloxa-luxury-card-pink rounded-[1.75rem] border border-pink-200 bg-white p-4 ring-1 ring-pink-100/80">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-black text-white">
                    <TrendingUp className="h-3 w-3" />
                    {copy.bentoMetaAdsBadge}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#D85A88]">
                    <span className="h-2 w-2 rounded-full bg-[#EC749B]" />
                    Active 24/7
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-neutral-200/80 bg-white p-2.5 text-center shadow-2xs">
                  <div>
                    <p className="text-[10px] font-bold text-neutral-400">ROAS</p>
                    <p className="text-sm font-black text-neutral-900">6.8x</p>
                  </div>
                  <div className="border-x border-neutral-200/70">
                    <p className="text-[10px] font-bold text-neutral-400">Cost / Lead</p>
                    <p className="text-sm font-black text-[#D85A88]">-43%</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-neutral-400">Winner Split</p>
                    <p className="text-sm font-black text-neutral-900">100%</p>
                  </div>
                </div>

                <p className="mt-2.5 text-[11px] text-neutral-600">
                  ✓ <strong className="text-neutral-900">Auto-Optimizer:</strong> Variasi iklan B (CPR mahal) dimatikan otomatis; 100% budget dialihkan ke Reels Pemenang A.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================================
         SECTION 1B: INFINITE LIVE GLOBAL PRODUCTION & META ADS TICKER MARQUEE
         Smooth compositor-thread horizontal scroll (pauses on hover or when motion paused)
         ============================================================================ */}
      <section
        aria-label="Live Global Autonomous Production Feed"
        data-testid="landing-live-marquee-ticker"
        className="veloxa-luxury-section overflow-hidden rounded-3xl border border-neutral-200/90 bg-white py-4"
      >
        <div className="veloxa-marquee-track flex items-center gap-4 px-4">
          {[...LIVE_GLOBAL_TICKER_ITEMS, ...LIVE_GLOBAL_TICKER_ITEMS].map((item, idx) => (
            <div
              key={`${item.badge}-${idx}`}
              className="veloxa-luxury-card flex shrink-0 items-center gap-2.5 rounded-2xl border border-neutral-200/90 bg-white px-4 py-2.5 text-xs"
            >
              <span className="rounded-full bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-black text-white">
                {item.badge}
              </span>
              <span className="font-semibold text-neutral-800">{item.text}</span>
              <span className="rounded-full border border-pink-200 bg-pink-50/60 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
                {item.metric}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================================
         SECTION 2: INTERACTIVE INDUSTRY VISUAL SHOWCASE (REELS + CAROUSEL + SINGLE POST)
         ============================================================================ */}
      <section
        className="veloxa-deferred-section veloxa-scroll-reveal veloxa-luxury-section rounded-[2rem] border border-neutral-200/90 bg-white p-6 sm:p-10"
        data-testid="landing-visual-gallery-section"
      >
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3.5 py-1 text-xs font-black text-[#D85A88]">
            <Layers className="h-3.5 w-3.5 text-[#EC749B]" />
            {copy.galleryEyebrow}
          </span>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-neutral-900 sm:text-4xl">
            {copy.galleryTitle}
          </h2>
          <p className="mt-2.5 text-sm text-neutral-600">{copy.gallerySubtitle}</p>
        </div>

        {/* Industry Selector Tabs */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {INDUSTRY_SHOWCASES.map((ind) => {
            const active = ind.id === activeIndustryId;
            return (
              <button
                key={ind.id}
                type="button"
                data-testid={`gallery-industry-tab-${ind.id}`}
                onClick={() => {
                  setActiveIndustryId(ind.id);
                  setGalleryCarouselIndex(0);
                }}
                className={`rounded-2xl px-4 py-2.5 text-xs font-black transition ${
                  active
                    ? 'veloxa-luxury-card-pink bg-[#EC749B] text-white'
                    : 'veloxa-luxury-card border border-neutral-200 bg-white text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]'
                }`}
              >
                {ind.tabLabel[locale]}
              </button>
            );
          })}
        </div>

        {/* Selected Brand Identity Bar */}
        <div className="veloxa-luxury-card mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200/90 bg-white px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EC749B] font-black text-white">
              {activeIndustry.brandName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <span className="font-black text-neutral-900">{activeIndustry.brandName}</span>{' '}
              <span className="font-semibold text-[#D85A88]">({activeIndustry.handle})</span>
              <p className="text-[11px] text-neutral-500">
                Target Market: {activeIndustry.city} · {activeIndustry.followers} Followers
              </p>
            </div>
          </div>
          <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-[11px] font-black text-[#D85A88]">
            ✓ Diproduksi Otomatis oleh 5 Agen OpenAI + Dual Brand Vault
          </span>
        </div>

        {/* 3-Column Visual Output Comparison: 1. 9:16 Reels, 2. 4:5 Carousel, 3. 4:5 Single Poster + Meta Ad */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* COLUMN 1: 9:16 VERTICAL REELS / TIKTOK / SHORTS */}
          <article className="veloxa-luxury-card flex flex-col justify-between rounded-3xl border border-neutral-200/90 bg-white p-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-neutral-900">{copy.formatReelsTitle}</span>
                <span className="rounded-full bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-black text-white">
                  9:16 VERTICAL
                </span>
              </div>

              <div className="relative mt-3.5 aspect-[9/13] w-full overflow-hidden rounded-2xl border border-neutral-900 bg-neutral-900 shadow-lg">
                <img
                  src={activeIndustry.reel.photoUrl}
                  alt={activeIndustry.reel.captionTitle}
                  loading="lazy"
                  width={540}
                  height={780}
                  onError={(e) => {
                    e.currentTarget.src = createFallbackSvg(
                      activeIndustry.reel.captionTitle,
                      activeIndustry.reel.hookBadge,
                    );
                  }}
                  className="veloxa-ken-burns h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/25" />

                <div className="absolute inset-x-3 top-3 flex items-center justify-between text-[11px] font-bold text-white">
                  <span className="rounded-full bg-black/60 px-2.5 py-0.5 backdrop-blur">
                    {activeIndustry.handle}
                  </span>
                  <span className="rounded-full bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-black">
                    {activeIndustry.reel.duration}
                  </span>
                </div>

                <div className="absolute inset-x-3 bottom-3 text-left text-white">
                  <span className="inline-block rounded-md bg-[#EC749B] px-2 py-0.5 text-[10px] font-black">
                    {activeIndustry.reel.hookBadge}
                  </span>
                  <p className="mt-1.5 text-sm font-black leading-snug">
                    {activeIndustry.reel.captionTitle}
                  </p>
                  <p className="mt-1 rounded-xl bg-white/15 p-2 text-[11px] italic text-white/95 backdrop-blur">
                    {activeIndustry.reel.voiceoverScript}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-neutral-200/80 pt-3 text-[11px] text-neutral-600">
              <span>❤️ {activeIndustry.reel.likes} · 💬 {activeIndustry.reel.comments}</span>
              <span className="font-black text-[#D85A88]">
                Quality Gate {activeIndustry.reel.qualityScore}/100
              </span>
            </div>
          </article>

          {/* COLUMN 2: 4:5 MULTI-SLIDE INTERACTIVE CAROUSEL */}
          <article className="veloxa-luxury-card flex flex-col justify-between rounded-3xl border border-neutral-200/90 bg-white p-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-neutral-900">
                  {copy.formatCarouselTitle}
                </span>
                <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
                  Slide {galleryCurrentSlide.slideNumber}/4
                </span>
              </div>

              <div className="relative mt-3.5 aspect-[4/4.6] w-full overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-900 shadow-lg">
                <img
                  src={galleryCurrentSlide.photoUrl}
                  alt={galleryCurrentSlide.headline}
                  loading="lazy"
                  width={600}
                  height={690}
                  onError={(e) => {
                    e.currentTarget.src = createFallbackSvg(
                      galleryCurrentSlide.headline,
                      galleryCurrentSlide.tag,
                    );
                  }}
                  className="veloxa-ken-burns h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

                <div className="absolute inset-x-4 bottom-4 text-left text-white">
                  <span className="inline-block rounded-md bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-black">
                    {galleryCurrentSlide.tag}
                  </span>
                  <h3 className="mt-1.5 text-base font-black leading-snug">
                    {galleryCurrentSlide.headline}
                  </h3>
                  <p className="mt-1 text-xs text-white/85">{galleryCurrentSlide.subtext}</p>
                </div>
              </div>

              {/* 4 Slide Selector Pills */}
              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {activeIndustry.carousel.slides.map((sl, idx) => (
                  <button
                    key={sl.slideNumber}
                    type="button"
                    data-testid={`gallery-carousel-slide-btn-${sl.slideNumber}`}
                    onClick={() => setGalleryCarouselIndex(idx)}
                    className={`rounded-xl py-1.5 text-[11px] font-black transition ${
                      idx === galleryCarouselIndex
                        ? 'bg-[#EC749B] text-white shadow-sm'
                        : 'border border-neutral-200 bg-white text-neutral-700 hover:border-pink-200'
                    }`}
                  >
                    Slide {sl.slideNumber}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-neutral-200/80 pt-3 text-[11px] text-neutral-600">
              <span>IG Carousel & TikTok Photo Mode</span>
              <span className="font-black text-neutral-900">4 Slides Auto-Layout</span>
            </div>
          </article>

          {/* COLUMN 3: 4:5 SINGLE FEED POSTER + AI META ADS PERFORMANCE */}
          <article className="veloxa-luxury-card-pink flex flex-col justify-between rounded-3xl border border-pink-200 bg-white p-5 ring-2 ring-pink-100/70">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-neutral-900">{copy.formatSingleTitle}</span>
                <span className="rounded-full bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-black text-white">
                  {activeIndustry.singlePost.metaAdRoas}
                </span>
              </div>

              <div className="relative mt-3.5 aspect-[4/4.1] w-full overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-900 shadow-lg">
                <img
                  src={activeIndustry.singlePost.photoUrl}
                  alt={activeIndustry.singlePost.headline}
                  loading="lazy"
                  width={600}
                  height={615}
                  onError={(e) => {
                    e.currentTarget.src = createFallbackSvg(
                      activeIndustry.singlePost.headline,
                      activeIndustry.singlePost.badge,
                    );
                  }}
                  className="veloxa-ken-burns h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

                <div className="absolute inset-x-4 bottom-4 text-left text-white">
                  <span className="inline-block rounded-md bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-black">
                    {activeIndustry.singlePost.badge}
                  </span>
                  <h3 className="mt-1.5 text-base font-black leading-snug">
                    {activeIndustry.singlePost.headline}
                  </h3>
                  <div className="mt-2 flex items-center justify-between rounded-xl bg-white/95 px-3 py-2 text-neutral-900">
                    <span className="text-xs font-black text-[#D85A88]">
                      {activeIndustry.singlePost.offerPrice}
                    </span>
                    <span className="text-[11px] font-black text-neutral-900">
                      {activeIndustry.singlePost.ctaLabel}
                    </span>
                  </div>
                </div>
              </div>

              {/* Meta Ads Targeting Telemetry Box */}
              <div className="mt-3 rounded-2xl border border-neutral-200/90 bg-white p-3 text-xs shadow-2xs">
                <div className="flex items-center justify-between font-bold text-neutral-900">
                  <span>Biaya per Konversi (CPR):</span>
                  <span className="text-[#D85A88]">{activeIndustry.singlePost.metaAdCpr}</span>
                </div>
                <p className="mt-1 text-[11px] text-neutral-500">
                  Target: {activeIndustry.singlePost.targetAudience}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {activeIndustry.singlePost.validatedInterests.map((intItem) => (
                    <span
                      key={intItem}
                      className="rounded-lg border border-pink-200 bg-pink-50/50 px-2 py-0.5 text-[10px] font-bold text-[#D85A88]"
                    >
                      {intItem}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 text-[11px] text-neutral-600">
              <span>✓ Pagar Budget Harian Aktif</span>
              <span className="font-black text-[#D85A88]">Meta Marketing API</span>
            </div>
          </article>
        </div>
      </section>

      {/* ============================================================================
         SECTION 3: DUAL BRAND VAULT & 5 OPENAI AGENTS ARCHITECTURE
         ============================================================================ */}
      <section className="veloxa-deferred-section veloxa-scroll-reveal veloxa-luxury-section rounded-[2rem] border border-neutral-200/90 bg-white p-6 sm:p-10">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3.5 py-1 text-xs font-black text-[#D85A88]">
            <Bot className="h-3.5 w-3.5 text-[#EC749B]" />
            {copy.vaultEyebrow}
          </span>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-neutral-900 sm:text-3xl">
            {copy.vaultTitle}
          </h2>
          <p className="mt-2 text-sm text-neutral-600">{copy.vaultSubtitle}</p>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="veloxa-luxury-card rounded-3xl border border-neutral-200/90 bg-white p-6">
            <span className="inline-block rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-black text-[#D85A88]">
              STEP 01 · VISION AI
            </span>
            <h3 className="mt-3 text-lg font-black text-neutral-900">{copy.vaultDrawer1Title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">{copy.vaultDrawer1Desc}</p>
            <div className="mt-4 rounded-2xl border border-neutral-200/80 bg-white p-3 text-xs shadow-2xs">
              <p className="font-bold text-neutral-900">Diekstrak Otomatis oleh Brand Brain:</p>
              <p className="mt-1 text-[11px] text-neutral-500">
                • Palet Warna & Kontras Tipografi · • Posisi Hook 3 Detik Pertama · • Struktur Call-to-Action
              </p>
            </div>
          </div>

          <div className="veloxa-luxury-card rounded-3xl border border-neutral-200/90 bg-white p-6">
            <span className="inline-block rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-black text-[#D85A88]">
              STEP 02 · REAL ASSETS
            </span>
            <h3 className="mt-3 text-lg font-black text-neutral-900">{copy.vaultDrawer2Title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">{copy.vaultDrawer2Desc}</p>
            <div className="mt-4 rounded-2xl border border-neutral-200/80 bg-white p-3 text-xs shadow-2xs">
              <p className="font-bold text-neutral-900">Sinkronisasi Kamera HP & Galeri:</p>
              <p className="mt-1 text-[11px] text-neutral-500">
                • Foto Produk / Menu Asli · • Dokumentasi Event / Klinik · • 100% Bebas Halusinasi Produk Palsu
              </p>
            </div>
          </div>

          <div className="veloxa-luxury-card-pink rounded-3xl border border-pink-300 bg-white p-6 ring-2 ring-pink-100">
            <span className="inline-block rounded-full bg-[#EC749B] px-3 py-1 text-xs font-black text-white">
              STEP 03 · 0-ERROR PUBLISH & ADS
            </span>
            <h3 className="mt-3 text-lg font-black text-neutral-900">{copy.vaultOutputTitle}</h3>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">{copy.vaultOutputDesc}</p>
            <div className="mt-4 rounded-2xl border border-pink-100 bg-pink-50/50 p-3 text-xs">
              <p className="font-bold text-[#D85A88]">Self-Healing Quality Gate (&gt;=88/100):</p>
              <p className="mt-1 text-[11px] text-neutral-600">
                • Cek Kontras & Ejaan · • Auto-Post 1x–4x Sehari · • Mode Countdown Event (H-30 s.d. Hari-H)
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================================
         SECTION 4: NATIVE MOBILE (iOS & ANDROID) + LOCAL-FIRST SHOWCASE
         ============================================================================ */}
      <section className="veloxa-deferred-section veloxa-scroll-reveal veloxa-luxury-section rounded-[2rem] border border-neutral-200/90 bg-white p-6 sm:p-10">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3.5 py-1 text-xs font-black text-[#D85A88]">
              <Smartphone className="h-3.5 w-3.5 text-[#EC749B]" />
              {copy.nativeEyebrow}
            </span>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-neutral-900 sm:text-3xl">
              {copy.nativeTitle}
            </h2>
            <p className="mt-2.5 text-sm leading-relaxed text-neutral-600">
              {copy.nativeSubtitle}
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="veloxa-luxury-card rounded-2xl border border-neutral-200/90 bg-white p-4">
                <p className="text-xs font-black text-neutral-900">
                  📱 iOS & Android Native Shell (Capacitor)
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  Unggah stok foto produk langsung dari kamera HP, terima notifikasi kampanye, dan kelola jadwal tayang dengan navigasi bawah yang ergonomis.
                </p>
              </div>
              <div className="veloxa-luxury-card rounded-2xl border border-neutral-200/90 bg-white p-4">
                <p className="text-xs font-black text-neutral-900">
                  ⚡ Local-First Sync Engine (Hemat 99% Firestore)
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  Buka aplikasi secara instan (0ms loading) berkat cache lokal terenkripsi FNV-1a yang hanya menyinkronkan ke cloud saat ada perubahan nyata.
                </p>
              </div>
            </div>
          </div>

          {/* Native Phone Frame Preview Card */}
          <div className="veloxa-float-slow veloxa-luxury-card mx-auto w-full max-w-sm rounded-[2.25rem] border-2 border-neutral-900 bg-white p-4">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5 text-[11px] font-bold text-neutral-700">
              <span>9:41 · Veloxa Native</span>
              <span className="rounded-full bg-pink-50 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
                iOS & Android Ready
              </span>
            </div>
            <div className="mt-3 space-y-2.5">
              <div className="rounded-2xl border border-neutral-200/90 bg-white p-3 text-xs shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-black text-neutral-900">Jadwal Otonom Hari Ini</span>
                  <span className="font-black text-[#EC749B]">3x Tayang</span>
                </div>
                <p className="mt-1 text-[11px] text-neutral-500">
                  07:00 WIB (Reels) · 12:30 WIB (Carousel) · 19:00 WIB (Single Post)
                </p>
              </div>
              <div className="rounded-2xl border border-pink-200 bg-pink-50/40 p-3 text-xs shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-black text-neutral-900">AI Meta Ads · Pagar Budget</span>
                  <span className="font-black text-[#D85A88]">Aman ✓</span>
                </div>
                <p className="mt-1 text-[11px] text-neutral-600">
                  100% budget dialihkan ke Reels Pemenang (ROAS 6.8x · 0 Overbudget).
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-1 rounded-2xl border border-neutral-200/90 bg-white p-1.5 text-center text-[9px] font-black shadow-2xs">
              <div className="rounded-xl bg-[#EC749B] py-1.5 text-white">
                {copy.mobileTabs.overview}
              </div>
              <div className="py-1.5 text-neutral-500">{copy.mobileTabs.brand_vault}</div>
              <div className="py-1.5 text-neutral-500">{copy.mobileTabs.studio}</div>
              <div className="py-1.5 text-neutral-500">{copy.mobileTabs.autonomy}</div>
              <div className="py-1.5 text-neutral-500">{copy.mobileTabs.meta_ads}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================================
         SECTION 5: GLOBAL COST COMPARISON (AGENCY VS VELOXA AI)
         ============================================================================ */}
      <section className="veloxa-deferred-section veloxa-scroll-reveal veloxa-luxury-section rounded-[2rem] border border-neutral-200/90 bg-white p-6 sm:p-10">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-black tracking-tight text-neutral-900 sm:text-3xl">
            {copy.compareTitle}
          </h2>
          <p className="mt-2 text-sm text-neutral-600">{copy.compareSubtitle}</p>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="veloxa-luxury-card rounded-3xl border border-neutral-200/90 bg-white p-6 text-xs">
            <span className="inline-block rounded-full border border-neutral-200 bg-white px-3 py-1 font-bold text-neutral-500">
              {copy.compareOldBadge}
            </span>
            <p className="mt-4 text-2xl font-black text-neutral-800 sm:text-3xl">
              {copy.compareOldPrice}
            </p>
            <ul className="mt-4 space-y-2.5 text-neutral-600">
              {copy.compareOldBullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <span className="font-black text-neutral-400">✕</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="veloxa-luxury-card-pink rounded-3xl border border-pink-300 bg-white p-6 text-xs ring-2 ring-pink-100">
            <span className="inline-block rounded-full bg-[#EC749B] px-3 py-1 font-black text-white">
              {copy.compareNewBadge}
            </span>
            <p className="mt-4 text-2xl font-black text-[#D85A88] sm:text-3xl">
              {copy.compareNewPrice}
            </p>
            <ul className="mt-4 space-y-2.5 text-neutral-700">
              {copy.compareNewBullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#EC749B]" />
                  <span className="font-medium">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ============================================================================
         SECTION 6: GLOBAL MULTI-CURRENCY PRICING TIERS
         ============================================================================ */}
      <section className="veloxa-deferred-section veloxa-scroll-reveal veloxa-luxury-section rounded-[2rem] border border-neutral-200/90 bg-white p-6 sm:p-10">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3.5 py-1 text-xs font-black text-[#D85A88]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#EC749B]" />
            {copy.pricingEyebrow}
          </span>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-neutral-900 sm:text-3xl">
            {copy.pricingTitle}
          </h2>
          <p className="mt-2 text-sm text-neutral-600">{copy.pricingSubtitle}</p>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {Object.values(SUBSCRIPTION_PLANS).map((plan) => {
            const localizedPrice = getPlanLocalizedPrice(plan.id, locale);
            const isPopular = plan.id === 'pro_1500k';
            return (
              <div
                key={plan.id}
                className={`flex flex-col justify-between rounded-3xl border bg-white p-6 transition ${
                  isPopular
                    ? 'veloxa-luxury-card-pink border-pink-300 ring-2 ring-pink-100'
                    : 'veloxa-luxury-card border-neutral-200/90'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-black text-neutral-900">{plan.name}</span>
                    {isPopular && (
                      <span className="rounded-full bg-[#EC749B] px-3 py-0.5 text-[10px] font-black text-white">
                        {copy.pricingMostPopular}
                      </span>
                    )}
                  </div>

                  <p className="mt-3 text-3xl font-black text-neutral-900">
                    {localizedPrice.amountFormatted}
                    <span className="text-xs font-semibold text-neutral-400">
                      {localizedPrice.periodLabel}
                    </span>
                  </p>

                  <p className="mt-1.5 text-xs text-neutral-500">{plan.tagline}</p>

                  <ul className="mt-5 space-y-2.5 border-t border-neutral-100 pt-4 text-xs text-neutral-600">
                    <li className="flex items-center justify-between">
                      <span>{copy.pricingQuotaLabel}:</span>
                      <strong className="text-neutral-900">
                        {plan.monthlyPostQuota} posts ({plan.maxPostsPerDay}x/day)
                      </strong>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>{copy.pricingChannelsLabel}:</span>
                      <strong className="text-neutral-900">
                        {plan.allowedChannels.length} Platforms
                      </strong>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>{copy.pricingEventModeLabel}:</span>
                      <strong className="text-neutral-900">
                        {plan.includesEventCampaigns
                          ? copy.pricingIncluded
                          : copy.pricingNotIncluded}
                      </strong>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>{copy.pricingMetaAdsLabel}:</span>
                      <strong
                        className={
                          plan.includesMetaAdsAgent ? 'text-[#D85A88]' : 'text-neutral-400'
                        }
                      >
                        {plan.includesMetaAdsAgent
                          ? `✓ ${copy.pricingIncluded}`
                          : copy.pricingNotIncluded}
                      </strong>
                    </li>
                  </ul>
                </div>

                <button
                  type="button"
                  data-testid={`landing-select-plan-${plan.id}`}
                  onClick={() => onOpenOnboarding(plan.id)}
                  className="mt-6 w-full rounded-2xl bg-[#EC749B] py-3.5 text-xs font-black text-white shadow-sm transition hover:bg-[#DF608A]"
                >
                  <Zap className="mr-1.5 inline h-3.5 w-3.5" />
                  {copy.pricingStartBtn} {plan.name}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============================================================================
         SECTION 7: ULTRA-LUXURY GLOBAL MULTI-LANGUAGE COMMERCIAL FOOTER
         ============================================================================ */}
      <footer
        data-testid="veloxa-global-footer"
        className="veloxa-deferred-section veloxa-luxury-section overflow-hidden rounded-[2rem] border border-neutral-200/90 bg-white"
      >
        {/* Top Conversion Banner inside Footer */}
        <div className="border-b border-neutral-100 bg-white p-6 sm:p-10">
          <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-[11px] font-black text-[#D85A88]">
                <Sparkles className="h-3.5 w-3.5 text-[#EC749B]" />
                VELOXA AI GLOBAL CLOUD · WEB · ANDROID · iOS
              </span>
              <h2 className="mt-3 text-2xl font-black tracking-tight text-neutral-900 sm:text-3xl">
                {footerCopy.ctaBannerTitle}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-neutral-600 sm:text-sm">
                {footerCopy.ctaBannerSubtitle}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="footer-cta-start-btn"
                onClick={() => onOpenOnboarding('pro_1500k')}
                className="veloxa-luxury-card-pink inline-flex items-center gap-2 rounded-2xl bg-[#EC749B] px-6 py-3.5 text-xs font-black text-white hover:bg-[#DF608A] sm:text-sm"
              >
                <Rocket className="h-4 w-4" />
                <span>{footerCopy.ctaBannerPrimary}</span>
              </button>
              <button
                type="button"
                data-testid="footer-cta-login-btn"
                onClick={onOpenAuthModal}
                className="veloxa-luxury-card rounded-2xl border border-neutral-200 bg-white px-5 py-3.5 text-xs font-bold text-neutral-800 hover:border-pink-200 hover:text-[#D85A88] sm:text-sm"
              >
                {footerCopy.ctaBannerSecondary}
              </button>
            </div>
          </div>
        </div>

        {/* Main 5-Column Global Footer Directory */}
        <div className="grid gap-8 bg-white p-6 sm:grid-cols-2 sm:p-10 lg:grid-cols-[1.45fr_1fr_1fr_1fr_1.15fr]">
          {/* Column 1: Brand Identity, Global Hubs & Live Uptime Status */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#EC749B] font-black text-white shadow-xs">
                V
              </div>
              <div>
                <span className="text-base font-black tracking-tight text-neutral-900">
                  VELOXA AI
                </span>
                <p className="text-[10px] font-bold text-[#D85A88]">
                  Autonomous 4-Channel & Meta Ads SaaS
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-neutral-500">{footerCopy.brandDesc}</p>

            <div className="inline-flex items-center gap-2 rounded-xl border border-pink-200 bg-pink-50/60 px-3 py-1.5 text-[11px] font-bold text-[#D85A88]">
              <span>{footerCopy.uptimeBadge}</span>
            </div>

            <p className="text-[11px] font-semibold text-neutral-400">
              Global Edge Nodes: Jakarta · Singapore · Tokyo · Seoul · Dubai · Frankfurt · San Francisco
            </p>
          </div>

          {/* Column 2: AI Studio & Brand Vault */}
          <div className="space-y-2.5 text-xs">
            <p className="font-black uppercase tracking-wider text-neutral-900">
              {footerCopy.colStudio}
            </p>
            <ul className="space-y-2 text-neutral-500">
              <li>
                <button
                  type="button"
                  onClick={() => onOpenOnboarding('pro_1500k')}
                  className="hover:text-[#D85A88]"
                >
                  9:16 Vertical Reels & Shorts Studio
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenOnboarding('growth_1000k')}
                  className="hover:text-[#D85A88]"
                >
                  4:5 Interactive Multi-Slide Carousel
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenOnboarding('starter_500k')}
                  className="hover:text-[#D85A88]"
                >
                  Single Feed Poster & Ad Creative
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onOpenAuthModal}
                  className="hover:text-[#D85A88]"
                >
                  Dual Brand Vault (Style DNA + Real Photos)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onOpenAuthModal}
                  className="hover:text-[#D85A88]"
                >
                  Self-Healing Quality Gate (0-Error)
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: 4-Channel OAuth & AI Meta Ads */}
          <div className="space-y-2.5 text-xs">
            <p className="font-black uppercase tracking-wider text-neutral-900">
              {footerCopy.colChannels}
            </p>
            <ul className="space-y-2 text-neutral-500">
              <li>Instagram Graph API (Reels & Feed)</li>
              <li>Facebook Page & Reels Publishing</li>
              <li>TikTok Direct Post & Photo Mode</li>
              <li>YouTube Data API v3 (Shorts 9:16)</li>
              <li className="font-bold text-[#D85A88]">
                AI Meta Ads Media Buyer 24/7
              </li>
            </ul>
          </div>

          {/* Column 4: Native Mobile & Cloud Architecture */}
          <div className="space-y-2.5 text-xs">
            <p className="font-black uppercase tracking-wider text-neutral-900">
              {footerCopy.colArchitecture}
            </p>
            <ul className="space-y-2 text-neutral-500">
              <li>Web Desktop Studio (Next.js 15)</li>
              <li>Android Native App (.apk Capacitor)</li>
              <li>iOS Native App (Xcode / Apple)</li>
              <li>Local-First FNV-1a (99% Firestore Guard)</li>
              <li>Zero 30% App Store Commission Billing</li>
            </ul>
          </div>

          {/* Column 5: Instant Global Market & Currency Switcher */}
          <div className="space-y-2.5 text-xs">
            <p className="font-black uppercase tracking-wider text-neutral-900">
              {footerCopy.colGlobal}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {VELOXA_LOCALES.map((loc) => (
                <button
                  key={loc.code}
                  type="button"
                  data-testid={`footer-lang-btn-${loc.code}`}
                  onClick={() => onSelectLocale(loc.code)}
                  className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-[11px] font-bold transition ${
                    loc.code === locale
                      ? 'border-[#EC749B] bg-pink-50/80 text-[#D85A88] shadow-2xs'
                      : 'border-neutral-200 bg-white text-neutral-700 shadow-2xs hover:border-pink-200'
                  }`}
                >
                  <span>{loc.flag}</span>
                  <span className="truncate">
                    {loc.code.toUpperCase()} · {loc.currencyCode}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Copyright & Official Compliance Bar */}
        <div className="border-t border-neutral-100 bg-white px-6 py-4 text-[11px] text-neutral-500 sm:px-10">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="font-semibold text-neutral-600">{footerCopy.copyright}</p>
            <div className="flex flex-wrap items-center gap-4 font-semibold">
              <span>Privacy Policy</span>
              <span>Terms of Service</span>
              <span>Meta Marketing API Compliance</span>
              <span className="text-[#D85A88]">ISO/IEC Cloud Security Ready</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
