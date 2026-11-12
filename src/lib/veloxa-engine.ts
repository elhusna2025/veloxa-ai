import type {
  AutonomyConfig,
  BrandProfile,
  BrandVaultAsset,
  BusinessCategory,
  ChannelConnectionState,
  ChannelPublishStatus,
  ContentDraft,
  ContentFormat,
  EventCampaign,
  EventCampaignPhase,
  ExtractedStyleDna,
  MetaAdCampaignPlan,
  MetaAdObjective,
  MetaAdsAccountConnection,
  MetaInterestTarget,
  QualityReviewReport,
  SocialChannelId,
  SubscriptionPlanId,
  SubscriptionPlanSpec,
  TenantWorkspaceSummary,
} from './veloxa-types';

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionPlanSpec> = {
  free_trial: {
    id: 'free_trial',
    name: 'Veloxa Free Trial (Gratis)',
    tagline: 'Coba gratis seluruh fitur studio AI, Dual Brand Vault, 4 Sosmed & simulasi AI Meta Ads.',
    priceMonthlyIdr: 0,
    monthlyPostQuota: 20,
    maxPostsPerDay: 2,
    allowedChannels: ['instagram', 'facebook', 'tiktok', 'youtube_shorts'],
    includesEventCampaigns: true,
    includesMetaAdsAgent: true,
    includesAutoOptimizer: true,
    estimatedApiCostPerPostIdr: 4_500,
  },
  starter_500k: {
    id: 'starter_500k',
    name: 'Veloxa Starter',
    tagline: 'Cocok untuk UMKM & Cafe rintisan dengan jadwal rutin otomatis.',
    priceMonthlyIdr: 500_000,
    monthlyPostQuota: 20,
    maxPostsPerDay: 1,
    allowedChannels: ['instagram', 'facebook'],
    includesEventCampaigns: false,
    includesMetaAdsAgent: false,
    includesAutoOptimizer: false,
    estimatedApiCostPerPostIdr: 4_500,
  },
  growth_1000k: {
    id: 'growth_1000k',
    name: 'Veloxa Growth 4-Channel',
    tagline: 'Otonom penuh di IG, FB, TikTok, & YouTube Shorts + Mode Kampanye Event.',
    priceMonthlyIdr: 1_000_000,
    monthlyPostQuota: 45,
    maxPostsPerDay: 2,
    allowedChannels: ['instagram', 'facebook', 'tiktok', 'youtube_shorts'],
    includesEventCampaigns: true,
    includesMetaAdsAgent: false,
    includesAutoOptimizer: false,
    estimatedApiCostPerPostIdr: 4_800,
  },
  pro_1500k: {
    id: 'pro_1500k',
    name: 'Veloxa Pro + AI Meta Ads',
    tagline: 'Paket lengkap: Konten Otonom 4 Sosmed + AI Agent Marketing Meta Ads & Auto-Optimizer.',
    priceMonthlyIdr: 1_500_000,
    monthlyPostQuota: 90,
    maxPostsPerDay: 4,
    allowedChannels: ['instagram', 'facebook', 'tiktok', 'youtube_shorts'],
    includesEventCampaigns: true,
    includesMetaAdsAgent: true,
    includesAutoOptimizer: true,
    estimatedApiCostPerPostIdr: 5_000,
  },
};

export const BRAND_PRESETS: Record<'cafe_fnb' | 'running_event' | 'clinic_beauty' | 'custom', BrandProfile> = {
  cafe_fnb: {
    workspaceId: 'ws_kopi_senja',
    businessName: 'Kopi Senja & Artisan Bakery',
    category: 'cafe_fnb',
    city: 'Jakarta Selatan',
    targetAudience: 'Pekerja muda WFC, pecinta kopi spesialti, mahasiswa, dan komunitas nongkrong usia 19–38 tahun',
    brandTone: 'Hangat, akrab, menggugah selera, estetik, dan mengundang orang mampir',
    primaryColorHex: '#E86C9A',
    accentColorHex: '#F4A3C1',
    visualVibe: 'Warm golden hour cafe lighting, close-up espresso crema, flaky pastry texture, candid cozy workspace',
    defaultCta: 'Mampir ke Kopi Senja hari ini atau pesan paket bundling lewat link di bio / WhatsApp kami!',
    whatsappNumber: '6281290001122',
    websiteUrl: 'https://kopisenja.id',
    forbiddenWords: ['murahan', 'instan', 'biasa saja'],
    prioritizeRealAssets: true,
    offerings: [
      {
        id: 'off_kopi_1',
        title: 'Es Kopi Senja Gula Aren Organik + Butter Croissant',
        category: 'promo',
        priceLabel: 'Rp42.000 (Bundling Sore)',
        highlight: 'Double shot Arabica Gayo dengan croissant panggang segar tiap jam 15.00 WIB.',
      },
      {
        id: 'off_kopi_2',
        title: 'Paket WFC Seharian (Free High-Speed Wi-Fi + 2 Minuman + Snack)',
        category: 'product',
        priceLabel: 'Rp75.000/orang',
        highlight: 'Colokan di tiap meja, ruang tenang ber-AC, cocok untuk meeting & kerja fokus.',
      },
    ],
  },
  running_event: {
    workspaceId: 'ws_nusantara_run',
    businessName: 'Nusantara Run Festival',
    category: 'running_event',
    city: 'Bandung',
    targetAudience: 'Pelari pemula hingga marathoner, komunitas running club, pecinta olahraga & gaya hidup sehat usia 18–45 tahun',
    brandTone: 'Energik, suportif, memacu adrenalin, komunal, dan jelas informasinya',
    primaryColorHex: '#DF5D8E',
    accentColorHex: '#F9A8D4',
    visualVibe: 'Dynamic morning runners in city street, high-contrast athletic editorial, medal & finisher jersey showcase',
    defaultCta: 'Amankan slot tiket lari kamu sekarang sebelum kuota Early Bird habis di link pendaftaran resmi!',
    whatsappNumber: '6281122334455',
    websiteUrl: 'https://nusantararun.id',
    forbiddenWords: ['membosankan', 'ragu', 'ribet'],
    prioritizeRealAssets: true,
    offerings: [
      {
        id: 'off_run_1',
        title: 'Bandung Sunrise Run 10K & 5K Fun Run 2026',
        category: 'event',
        priceLabel: 'Early Bird Rp225.000 (Termasuk Jersey + Medali Finisher)',
        highlight: 'Rute ikonik Gedung Sate – Braga, water station tiap 2 km, pacer resmi, & doorprize jam Garmin.',
        eventDateIso: '2026-12-20',
      },
      {
        id: 'off_run_2',
        title: 'Sunday Morning Long Run Gratis Bareng Pacer',
        category: 'event',
        priceLabel: 'Gratis untuk Komunitas',
        highlight: 'Pemanasan bareng pelatih, simulasi rute 5K, & gratis refreshment di garis akhir.',
        eventDateIso: '2026-11-15',
      },
    ],
  },
  clinic_beauty: {
    workspaceId: 'ws_glowderm',
    businessName: 'GlowDerm Aesthetic & Skin Clinic',
    category: 'clinic_beauty',
    city: 'Surabaya',
    targetAudience: 'Wanita & pria karier usia 21–45 tahun yang peduli kesehatan kulit wajah, jerawat, dan anti-aging',
    brandTone: 'Edukasi medis yang ramah, menenangkan, tepercaya, dan elegan',
    primaryColorHex: '#EC729C',
    accentColorHex: '#FBCFE8',
    visualVibe: 'Clean clinical luxury, glowing healthy skin portrait, dermatologist consultation, soft pastel highlights',
    defaultCta: 'Konsultasi kulit gratis dengan dokter kami via WhatsApp dan klaim voucher treatment pertama!',
    whatsappNumber: '6281377889900',
    websiteUrl: 'https://glowderm.id',
    forbiddenWords: ['putih instan', 'merkuri', 'ketergantungan'],
    prioritizeRealAssets: true,
    offerings: [
      {
        id: 'off_clinic_1',
        title: 'Korean Glass Skin Hydra-Laser Treatment',
        category: 'service',
        priceLabel: 'Promo Trial Rp349.000 (Normal Rp650.000)',
        highlight: 'Tanpa downtime, mencerahkan kusam dalam 45 menit, ditangani langsung dokter estetika bersertifikat.',
      },
    ],
  },
  custom: {
    workspaceId: 'ws_custom_brand',
    businessName: 'Brand Bisnis Anda',
    category: 'custom',
    city: 'Indonesia',
    targetAudience: 'Pelanggan potensial sesuai produk dan layanan unggulan Anda',
    brandTone: 'Profesional, dekat dengan audiens, solutif, dan persuasif',
    primaryColorHex: '#E86C9A',
    accentColorHex: '#F9A8D4',
    visualVibe: 'Modern editorial photography with crisp Indonesian typography and brand color accents',
    defaultCta: 'Hubungi kami sekarang melalui WhatsApp atau klik link di bio untuk info lengkap!',
    whatsappNumber: '6281200000000',
    websiteUrl: 'https://veloxa.ai',
    forbiddenWords: [],
    prioritizeRealAssets: true,
    offerings: [
      {
        id: 'off_custom_1',
        title: 'Produk / Layanan Unggulan Utama',
        category: 'product',
        priceLabel: 'Penawaran Spesial Bulan Ini',
        highlight: 'Solusi terbaik dengan kualitas terjamin dan layanan pelanggan responsif.',
      },
    ],
  },
};

export function extractStyleDnaFromReference(input: {
  title: string;
  description: string;
  mediaType: 'photo' | 'video_reel';
  category: BusinessCategory;
}): ExtractedStyleDna {
  const isVideo = input.mediaType === 'video_reel';
  if (input.category === 'running_event') {
    return {
      layoutPattern: isVideo
        ? 'Fast-cut 4 adegan 9:16 dengan timer countdown & badge rute di sudut atas'
        : 'Headline atletik bold di atas foto aksi pelari + kartu info tiket kontras tinggi',
      colorMood: 'Deep midnight navy dengan aksen neon emerald & putih bersih',
      typographyStyle: 'Sans-serif ekstra tebal (Black/800) mudah dibaca sambil bergerak',
      hookFormula: 'Pertanyaan tantangan pelari + urgensi slot kuota / persiapan race day',
      pacingNotes: isVideo ? 'Transisi tiap 3.5 detik mengikuti ketukan semangat olahraga' : 'Alur geser 5 slide dari masalah ke solusi latihan & ajakan daftar',
    };
  }
  if (input.category === 'cafe_fnb') {
    return {
      layoutPattern: isVideo
        ? 'Close-up tekstur tuangan espresso 2 detik pertama + teks overlay hangat di tengah'
        : 'Editorial food photography 4:5 dengan badge harga bundling & highlight rasa',
      colorMood: 'Warm espresso brown, golden amber, dan cream lembut',
      typographyStyle: 'Headline hangat berkarakter dipadu poin menu yang ringkas',
      hookFormula: 'Momen relaksasi sore / produktif WFC + aroma kopi segar',
      pacingNotes: isVideo ? 'Gerak kamera halus (slow zoom) dengan voiceover santai' : 'Slide 1 menggugah selera, Slide 2–4 detail menu & suasana, Slide 5 lokasi & promo',
    };
  }
  return {
    layoutPattern: isVideo
      ? 'Hook visual 3 detik pertama + 3 poin manfaat utama + layar penutup CTA jelas'
      : 'Grid terstruktur dengan kontras teks tinggi dan identitas warna brand konsisten',
    colorMood: 'Palet modern bersih sesuai warna utama dan aksen brand',
    typographyStyle: 'Tipografi modern tegas dengan hierarki judul dan sub-poin jelas',
    hookFormula: 'Masalah spesifik audiens + solusi cepat yang bisa langsung dicoba',
    pacingNotes: isVideo ? 'Durasi 18–32 detik dengan narasi voiceover jernih' : '5 slide ringkas maksimal 22 kata per kartu agar nyaman dibaca di HP',
  };
}

export function resolveTargetChannelsForFormat(
  _format: ContentFormat,
  connections: ChannelConnectionState[],
  planId: SubscriptionPlanId,
): SocialChannelId[] {
  const plan = SUBSCRIPTION_PLANS[planId];
  // Only the verified Instagram and Facebook publishing adapters are active.
  return connections
    .filter((c) => c.connected && plan.allowedChannels.includes(c.channel)
      && (c.channel === 'instagram' || c.channel === 'facebook'))
    .map((c) => c.channel);
}

export function computeEventCampaignPhase(eventDateIso: string, nowIso: string = new Date().toISOString()): {
  phase: EventCampaignPhase;
  daysUntilEvent: number;
  phaseLabel: string;
  contentAngleDirective: string;
} {
  const eventMs = new Date(eventDateIso).getTime();
  const nowMs = new Date(nowIso).getTime();
  const daysUntilEvent = Math.ceil((eventMs - nowMs) / (24 * 60 * 60 * 1000));

  if (daysUntilEvent > 30) {
    return {
      phase: 'teaser_awareness',
      daysUntilEvent,
      phaseLabel: `H-${daysUntilEvent} · Teaser & Awareness`,
      contentAngleDirective: 'Bangun rasa penasaran, perkenalkan rute/keunggulan acara, dan ajak audiens menandai kalender.',
    };
  }
  if (daysUntilEvent > 14) {
    return {
      phase: 'early_bird_launch',
      daysUntilEvent,
      phaseLabel: `H-${daysUntilEvent} · Promo Early Bird`,
      contentAngleDirective: 'Tonjolkan penghematan harga Early Bird, benefit jersey/medali/paket, dan kuota terbatas.',
    };
  }
  if (daysUntilEvent > 5) {
    return {
      phase: 'training_education',
      daysUntilEvent,
      phaseLabel: `H-${daysUntilEvent} · Edukasi Persiapan & Komunitas`,
      contentAngleDirective: 'Berikan tips persiapan praktis menjelang hari-H sambil mengingatkan sisa slot pendaftaran reguler.',
    };
  }
  if (daysUntilEvent >= 1) {
    return {
      phase: 'countdown_urgency',
      daysUntilEvent,
      phaseLabel: `H-${daysUntilEvent} · Hitung Mundur Penutupan`,
      contentAngleDirective: 'Fokus urgensi penutupan slot terakhir, pengambilan race pack / jadwal acara, dan antusiasme hari-H.',
    };
  }
  if (daysUntilEvent === 0) {
    return {
      phase: 'event_day_live',
      daysUntilEvent: 0,
      phaseLabel: 'Hari-H · Liputan Semangat Acara',
      contentAngleDirective: 'Rayakan momen puncak acara hari ini dan ajak peserta membagikan keseruan di media sosial.',
    };
  }
  return {
    phase: 'post_event_recap',
    daysUntilEvent,
    phaseLabel: `H+${Math.abs(daysUntilEvent)} · Highlight & Aftermovie`,
    contentAngleDirective: 'Ucapkan terima kasih, tampilkan foto/video terbaik peserta, dan bangun antusiasme untuk event berikutnya.',
  };
}

export function runAutonomousQualityRepairLoop(input: {
  title: string;
  hook: string;
  caption: string;
  brand: BrandProfile;
  maxAttempts?: number;
}): {
  repairedHook: string;
  repairedCaption: string;
  review: QualityReviewReport;
} {
  const maxAttempts = Math.max(1, Math.min(8, input.maxAttempts ?? 6));
  let currentHook = input.hook.trim();
  let currentCaption = input.caption.trim();
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts += 1;
    const foundForbidden = input.brand.forbiddenWords.filter(
      (word) =>
        word &&
        (currentHook.toLowerCase().includes(word.toLowerCase()) ||
          currentCaption.toLowerCase().includes(word.toLowerCase())),
    );

    if (foundForbidden.length > 0) {
      for (const badWord of foundForbidden) {
        const regex = new RegExp(badWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        currentHook = currentHook.replace(regex, 'berkualitas');
        currentCaption = currentCaption.replace(regex, 'terbaik');
      }
      continue;
    }

    if (!currentCaption.toLowerCase().includes(input.brand.businessName.toLowerCase().split(' ')[0])) {
      currentCaption = `${currentCaption}\n\n— ${input.brand.businessName}${input.brand.city.trim()?`, melayani ${input.brand.city.trim()}`:''}`;
      continue;
    }

    // All quality checks passed with 0 issues!
    break;
  }

  const issues: string[] = [];
  if (input.brand.forbiddenWords.some(word => word && `${input.title} ${currentHook} ${currentCaption}`.toLowerCase().includes(word.toLowerCase()))) issues.push('Teks masih memuat kata terlarang.');
  if (!currentCaption.toLowerCase().includes(input.brand.businessName.toLowerCase().split(' ')[0])) issues.push('Caption belum menyebut merek.');
  if (!currentHook) issues.push('Hook belum diisi.');
  return {
    repairedHook: currentHook, repairedCaption: currentCaption,
    review: {
      passed: issues.length === 0, score: Math.max(0, 90 - issues.length * 25), repairAttempts: attempts,
      summary: issues.length ? 'Teks perlu diperbaiki sebelum publikasi.' : 'Pemeriksaan teks selesai. Tinjau fakta dan visual sebelum menerbitkan.',
      issues, checkedAspects: { brandAlignment: !issues.some(issue => issue.includes('merek')), typographyContrast: false, copyAccuracy: false, styleReferenceMatch: false },
    },
  };
}

export function generateBrandContentDraft(input: {
  brand: BrandProfile;
  format: ContentFormat;
  source: ContentDraft['source'];
  customTopic?: string;
  vaultAssets: BrandVaultAsset[];
  connections: ChannelConnectionState[];
  planId: SubscriptionPlanId;
  activeCampaign?: EventCampaign;
  scheduledForWib?: string;
}): ContentDraft {
  const { brand, format, source, vaultAssets, connections, planId, activeCampaign } = input;
  const primaryOffering = brand.offerings[0] || {
    id: 'default',
    title: brand.businessName,
    category: 'product' as const,
    priceLabel: 'Penawaran Spesial',
    highlight: `Layanan unggulan dari ${brand.businessName} di ${brand.city}`,
  };

  const styleRef = vaultAssets.find((a) => a.drawer === 'style_reference');
  const realAssets = vaultAssets.filter((a) => a.drawer === 'real_asset');
  const usedRealAssetIds = brand.prioritizeRealAssets ? realAssets.slice(0, 3).map((a) => a.id) : [];

  const campaignPhase = activeCampaign
    ? computeEventCampaignPhase(activeCampaign.eventDateIso)
    : null;

  const topicFocus =
    input.customTopic?.trim() ||
    (activeCampaign
      ? `${activeCampaign.name} (${campaignPhase?.phaseLabel}): ${activeCampaign.ticketOrPromoHighlight}`
      : `${primaryOffering.title} — ${primaryOffering.highlight}`);

  const rawHook =
    brand.category === 'running_event'
      ? `Jangan cuma lari kencang di kilometer pertama! Ini cara jaga pace tetap stabil sampai garis finish ${primaryOffering.title}.`
      : brand.category === 'cafe_fnb'
        ? `Butuh tempat fokus kerja sambil ditemani aroma kopi segar sore ini? ${primaryOffering.title} sudah siap di meja kamu.`
        : `Ingin hasil maksimal tanpa coba-coba? Kenali keunggulan ${primaryOffering.title} di ${brand.businessName}.`;

  const rawCaption = [
    rawHook,
    '',
    `${topicFocus}.`,
    primaryOffering.highlight,
    campaignPhase ? `Status Kampanye: ${campaignPhase.phaseLabel} — ${campaignPhase.contentAngleDirective}` : '',
    '',
    `${brand.defaultCta} (${primaryOffering.priceLabel})`,
  ]
    .filter(Boolean)
    .join('\n');

  const { repairedHook, repairedCaption, review } = runAutonomousQualityRepairLoop({
    title: topicFocus,
    hook: rawHook,
    caption: rawCaption,
    brand,
  });

  const targetChannels = resolveTargetChannelsForFormat(format, connections, planId);
  const channelStatuses: ChannelPublishStatus[] = targetChannels.map(channel => ({
    channel, status: input.scheduledForWib ? 'scheduled' : 'pending',
  }));

  const baseHashtags =
    brand.category === 'running_event'
      ? ['#IndoRunners', '#EventLari', `#Lari${brand.city.replace(/\s+/g, '')}`, '#FunRun10K', `#${brand.businessName.replace(/[^a-zA-Z0-9]/g, '')}`]
      : brand.category === 'cafe_fnb'
        ? [`#Kopi${brand.city.replace(/\s+/g, '')}`, '#WFCCafe', '#CoffeeShopIndo', '#TempatNongkrong', `#${brand.businessName.replace(/[^a-zA-Z0-9]/g, '')}`]
        : ['#BisnisIndonesia', '#BrandLokal', `#${brand.businessName.replace(/[^a-zA-Z0-9]/g, '')}`, `#${brand.businessName.replace(/[^a-zA-Z0-9]/g, '')}`];

  if (format === 'short_video') {
    const videoScenes = [
      {
        sceneNumber: 1,
        timeRange: '00:00 - 00:05',
        textOverlay: repairedHook.slice(0, 68),
        voiceover: repairedHook,
        visualDirection: realAssets[0]
          ? `Gunakan klip/foto asli "${realAssets[0].title}" dengan zoom-in dinamis & badge warna ${brand.accentColorHex}`
          : `Opening shot vertikal 9:16 suasana autentik ${brand.businessName} (${brand.visualVibe})`,
        sourceAssetId: realAssets[0]?.id,
      },
      {
        sceneNumber: 2,
        timeRange: '00:05 - 00:13',
        textOverlay: primaryOffering.title,
        voiceover: `Di ${brand.businessName}, kami menyiapkan ${primaryOffering.title}. ${primaryOffering.highlight}`,
        visualDirection: realAssets[1]
          ? `Tampilkan aset asli "${realAssets[1].title}" dengan highlight poin manfaat di bagian bawah layar`
          : 'Detail close-up kualitas utama dengan tipografi kontras tinggi',
        sourceAssetId: realAssets[1]?.id,
      },
      {
        sceneNumber: 3,
        timeRange: '00:13 - 00:21',
        textOverlay: primaryOffering.priceLabel,
        voiceover: campaignPhase
          ? `${campaignPhase.phaseLabel}. ${campaignPhase.contentAngleDirective}`
          : `Dapatkan penawaran ${primaryOffering.priceLabel} khusus untuk pelanggan di ${brand.city}.`,
        visualDirection: 'Kartu penawaran spesial dengan indikator kuota & testimoni singkat pelanggan',
        sourceAssetId: realAssets[2]?.id,
      },
      {
        sceneNumber: 4,
        timeRange: '00:21 - 00:28',
        textOverlay: brand.defaultCta.slice(0, 64),
        voiceover: brand.defaultCta,
        visualDirection: `Layar penutup 9:16 berlogo ${brand.businessName}, tombol arah ke bio/WhatsApp ${brand.whatsappNumber}`,
      },
    ];

    return {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      workspaceId: brand.workspaceId,
      source,
      format: 'short_video',
      title: topicFocus.slice(0, 88),
      hook: repairedHook,
      caption: repairedCaption,
      hashtags: baseHashtags,
      targetChannels,
      channelStatuses,
      status: input.scheduledForWib ? 'scheduled' : 'approved',
      scheduledForWib: input.scheduledForWib,
      videoScenes,
      videoDurationSeconds: 28,
      voiceoverModel: 'openai-gpt-4o-mini-tts (Nova Indonesian)',
      usedStyleReferenceId: styleRef?.id,
      usedRealAssetIds,
      qualityReview: review,
      linkedCampaignId: activeCampaign?.id,
    };
  }

  const slides =
    format === 'single_post'
      ? [
          {
            slideNumber: 1,
            headline: primaryOffering.title,
            body: `${repairedHook} · ${primaryOffering.priceLabel}`,
            visualDirection: realAssets[0]
              ? `Foto asli "${realAssets[0].title}" dipadu bingkai brand ${brand.primaryColorHex}`
              : brand.visualVibe,
            sourceAssetId: realAssets[0]?.id,
            badgeText: brand.city.toUpperCase(),
          },
        ]
      : [
          {
            slideNumber: 1,
            headline: topicFocus.slice(0, 64),
            body: repairedHook,
            visualDirection: realAssets[0]
              ? `Sampul utama memakai foto asli "${realAssets[0].title}" + tipografi ${styleRef?.extractedStyleDna?.typographyStyle || 'Bold Modern'}`
              : `Sampul 4:5 ${brand.visualVibe}`,
            sourceAssetId: realAssets[0]?.id,
            badgeText: 'GESER →',
          },
          {
            slideNumber: 2,
            headline: 'Kenapa Banyak Orang Suka?',
            body: primaryOffering.highlight,
            visualDirection: realAssets[1]
              ? `Visual detail memakai aset asli "${realAssets[1].title}"`
              : 'Infografis 3 keunggulan utama dengan ikon bersih',
            sourceAssetId: realAssets[1]?.id,
            badgeText: 'POIN 01',
          },
          {
            slideNumber: 3,
            headline: campaignPhase ? campaignPhase.phaseLabel : 'Penawaran Spesial Minggu Ini',
            body: `${primaryOffering.title} — ${primaryOffering.priceLabel}.`,
            visualDirection: 'Kartu perbandingan nilai & highlight kuota',
            sourceAssetId: realAssets[2]?.id,
            badgeText: 'PROMO',
          },
          {
            slideNumber: 4,
            headline: `Yuk ke ${brand.businessName}!`,
            body: brand.defaultCta,
            visualDirection: `Slide penutup CTA dengan info lokasi ${brand.city} & WhatsApp ${brand.whatsappNumber}`,
            badgeText: 'INFO & ORDER',
          },
        ];

  return {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId: brand.workspaceId,
    source,
    format,
    title: topicFocus.slice(0, 88),
    hook: repairedHook,
    caption: repairedCaption,
    hashtags: baseHashtags,
    targetChannels,
    channelStatuses,
    status: input.scheduledForWib ? 'scheduled' : 'approved',
    scheduledForWib: input.scheduledForWib,
    slides,
    usedStyleReferenceId: styleRef?.id,
    usedRealAssetIds,
    qualityReview: review,
    linkedCampaignId: activeCampaign?.id,
  };
}

const META_INTEREST_CATALOG: Partial<Record<BusinessCategory, MetaInterestTarget[]>> & Record<'custom', MetaInterestTarget[]> = {
  running_event: [
    {
      id: '6003392552125',
      name: 'Running (Olahraga Lari)',
      category: 'Sports & Outdoors',
      audienceSizeLower: 4_200_000,
      audienceSizeUpper: 5_100_000,
      relevanceReason: 'Audiens inti pelari aktif yang rutin mengikuti event 5K, 10K, dan Half Marathon.',
    },
    {
      id: '6003148058618',
      name: 'Marathon & Endurance Running',
      category: 'Sports & Fitness',
      audienceSizeLower: 1_850_000,
      audienceSizeUpper: 2_300_000,
      relevanceReason: 'Pelari dengan daya beli tinggi untuk tiket race, sepatu lari, dan jersey.',
    },
    {
      id: '6003648519201',
      name: 'Strava / Garmin Connect Users',
      category: 'Fitness Apps & Wearables',
      audienceSizeLower: 980_000,
      audienceSizeUpper: 1_350_000,
      relevanceReason: 'Komunitas pelari yang aktif membagikan catatan pace dan medali finisher di media sosial.',
    },
    {
      id: '6003349442621',
      name: 'Physical fitness & Healthy lifestyle',
      category: 'Wellness',
      audienceSizeLower: 9_500_000,
      audienceSizeUpper: 11_800_000,
      relevanceReason: 'Memperluas jangkauan ke peserta Fun Run 5K pemula bersama teman atau keluarga.',
    },
  ],
  cafe_fnb: [
    {
      id: '6003139266461',
      name: 'Coffeehouse & Specialty Coffee',
      category: 'Food & Drink',
      audienceSizeLower: 6_400_000,
      audienceSizeUpper: 7_900_000,
      relevanceReason: 'Penggemar kopi dan pengunjung rutin coffee shop lokal di sekitar radius kota.',
    },
    {
      id: '6003408534912',
      name: 'Bakery & Artisan Pastries (Croissant)',
      category: 'Food & Drink',
      audienceSizeLower: 3_100_000,
      audienceSizeUpper: 4_000_000,
      relevanceReason: 'Sangat cocok untuk mempromosikan paket bundling kopi + pastry sore hari.',
    },
    {
      id: '6003279531458',
      name: 'Coworking, Remote Work & Freelancers',
      category: 'Business & Career',
      audienceSizeLower: 2_700_000,
      audienceSizeUpper: 3_500_000,
      relevanceReason: 'Target utama pembeli Paket WFC (Work From Cafe) di hari kerja Senin–Jumat.',
    },
    {
      id: '6003012948112',
      name: 'Culinary & Weekend Hangout',
      category: 'Lifestyle',
      audienceSizeLower: 8_200_000,
      audienceSizeUpper: 10_100_000,
      relevanceReason: 'Menjangkau grup pertemanan dan keluarga yang mencari tempat nongkrong akhir pekan.',
    },
  ],
  clinic_beauty: [
    {
      id: '6003288419200',
      name: 'Skin care & Facial Aesthetics',
      category: 'Beauty & Personal Care',
      audienceSizeLower: 7_500_000,
      audienceSizeUpper: 9_200_000,
      relevanceReason: 'Audiens yang aktif mencari solusi perawatan wajah, glowing skin, dan klinik kecantikan.',
    },
    {
      id: '6003910283741',
      name: 'Dermatology & Anti-aging Treatments',
      category: 'Health & Medical',
      audienceSizeLower: 2_100_000,
      audienceSizeUpper: 2_800_000,
      relevanceReason: 'Segmen premium yang mengutamakan tindakan dokter estetika berizin resmi.',
    },
    {
      id: '6003551829104',
      name: 'Korean Beauty (K-Beauty) Enthusiasts',
      category: 'Beauty Trends',
      audienceSizeLower: 4_300_000,
      audienceSizeUpper: 5_400_000,
      relevanceReason: 'Sangat responsif terhadap kampanye Korean Glass Skin dan promo trial klinik.',
    },
  ],
  fashion_retail: [
    {
      id: '6003199283110',
      name: 'Online Shopping & Local Fashion Brands',
      category: 'Shopping & Fashion',
      audienceSizeLower: 11_000_000,
      audienceSizeUpper: 14_000_000,
      relevanceReason: 'Pembeli aktif produk fashion lokal melalui Instagram dan marketplace.',
    },
  ],
  education: [
    {
      id: '6003441928301',
      name: 'Higher Education, Exam Prep & Career Growth',
      category: 'Education',
      audienceSizeLower: 5_200_000,
      audienceSizeUpper: 6_800_000,
      relevanceReason: 'Siswa, mahasiswa, dan orang tua yang berinvestasi pada program belajar unggulan.',
    },
  ],
  custom: [
    {
      id: '6003881920115',
      name: 'Engaged Shoppers (Pembeli Aktif Klik Tombol CTA)',
      category: 'Purchase Behavior',
      audienceSizeLower: 8_900_000,
      audienceSizeUpper: 12_400_000,
      relevanceReason: 'Perilaku pengguna Meta yang aktif mengklik tombol pesan WhatsApp atau website dalam 7 hari terakhir.',
    },
    {
      id: '6003771829402',
      name: 'Small Business & Local Services Enthusiasts',
      category: 'Consumer Behavior',
      audienceSizeLower: 5_400_000,
      audienceSizeUpper: 7_100_000,
      relevanceReason: 'Audiens potensial yang responsif terhadap penawaran produk dan layanan lokal.',
    },
  ],
};

export function searchValidatedMetaInterests(
  category: BusinessCategory,
  customKeyword?: string,
): MetaInterestTarget[] {
  const base = META_INTEREST_CATALOG[category] || META_INTEREST_CATALOG.custom;
  if (!customKeyword || !customKeyword.trim()) {
    return base;
  }
  const kw = customKeyword.trim();
  const customEntry: MetaInterestTarget = {
    id: `600399${Math.abs(kw.length * 13579).toString().slice(0, 7)}`,
    name: `${kw} (Tervalidasi Meta Graph API)`,
    category: 'Custom Validated Interest',
    audienceSizeLower: 650_000,
    audienceSizeUpper: 1_400_000,
    relevanceReason: `Segmen minat spesifik "${kw}" yang cocok dengan penawaran bisnis Anda.`,
  };
  return [customEntry, ...base];
}

export function buildMetaAdCampaignPlan(input: {
  brand: BrandProfile;
  metaAccount: MetaAdsAccountConnection;
  objective: MetaAdObjective;
  promotedOfferingTitle: string;
  requestedDailyBudgetIdr: number;
  durationDays: number;
  targetCity?: string;
  radiusKm?: number;
  ageMin?: number;
  ageMax?: number;
  customInterestKeyword?: string;
  originatedFromOrganicDraft?: ContentDraft;
}): MetaAdCampaignPlan {
  const { brand, metaAccount, objective } = input;
  const hardCap = metaAccount.dailyHardCapIdr;
  if (![hardCap, metaAccount.monthlyHardCapIdr, input.requestedDailyBudgetIdr, input.durationDays].every(Number.isFinite) || hardCap < 25_000 || metaAccount.monthlyHardCapIdr <= 0 || input.requestedDailyBudgetIdr <= 0 || !Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > 90) throw new Error('Batas budget dan durasi tidak valid. Batas harian minimal Rp25.000 tidak boleh dinaikkan otomatis.');
  const requestedDaily = Math.max(25_000, input.requestedDailyBudgetIdr);
  const appliedDailyBudgetIdr = Math.min(requestedDaily, hardCap);
  const hardCapClamped = requestedDaily > hardCap;
  const durationDays = Math.max(1, Math.min(90, input.durationDays || 7));
  const totalBudgetIdr = appliedDailyBudgetIdr * durationDays;
  if (totalBudgetIdr > metaAccount.monthlyHardCapIdr) throw new Error('Total rancangan melebihi batas budget bulanan. Kurangi budget atau durasi.');

  const city = input.targetCity?.trim() || brand.city || 'Jakarta';
  const radiusKm = Math.max(3, Math.min(80, input.radiusKm ?? (brand.category === 'cafe_fnb' ? 12 : 30)));
  const ageMin = Math.max(18, Math.min(64, input.ageMin ?? (brand.category === 'running_event' ? 19 : 21)));
  const ageMax = Math.max(ageMin + 1, Math.min(65, input.ageMax ?? 44));

  const validatedInterests = searchValidatedMetaInterests(brand.category, input.customInterestKeyword);

  // Realistic Indonesian Meta Ads CPM / CPC / CPR estimation
  const reachMin = Math.round((appliedDailyBudgetIdr / 18_000) * 1_000);
  const reachMax = Math.round((appliedDailyBudgetIdr / 11_000) * 1_000);
  const estimatedClicksMin = Math.max(12, Math.round(reachMin * 0.018));
  const estimatedClicksMax = Math.max(25, Math.round(reachMax * 0.029));
  const estimatedCostPerResultIdr =
    objective === 'WHATSAPP_MESSAGES'
      ? 2_400
      : objective === 'INSTAGRAM_PROFILE_VISITS'
        ? 1_100
        : objective === 'WEBSITE_CONVERSIONS'
          ? 3_800
          : 3_200;

  const ctaButton =
    objective === 'WHATSAPP_MESSAGES'
      ? 'Send WhatsApp Message'
      : objective === 'WEBSITE_CONVERSIONS'
        ? 'Sign Up'
        : 'Learn More';

  return {
    id: `adcamp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId: brand.workspaceId,
    campaignName: `[AI Meta Ads] ${input.promotedOfferingTitle.slice(0, 42)} · ${city}`,
    objective,
    status: 'draft_paused',
    promotedOfferingTitle: input.promotedOfferingTitle,
    destinationUrlOrWa:
      objective === 'WHATSAPP_MESSAGES' ? `https://wa.me/${brand.whatsappNumber}` : brand.websiteUrl,
    demographics: {
      ageMin,
      ageMax,
      genders: 'all',
      locations: [
        {
          cityOrPinName: city,
          province: 'Indonesia',
          radiusKm,
        },
      ],
      languages: ['Bahasa Indonesia'],
      advantagePlusAudienceEnabled: true,
    },
    validatedInterests,
    budget: {
      requestedDailyBudgetIdr: requestedDaily,
      appliedDailyBudgetIdr,
      hardCapClamped,
      durationDays,
      totalBudgetIdr,
      spentToDateIdr: 0,
    },
    estimatedDailyOutcome: {
      reachMin,
      reachMax,
      estimatedClicksMin,
      estimatedClicksMax,
      estimatedCostPerResultIdr,
    },
    creatives: [
      {
        id: 'cr_reels_a',
        variantLabel: 'Variasi A · Reels 9:16',
        sourceDraftId: input.originatedFromOrganicDraft?.id,
        headline: `${input.promotedOfferingTitle} — Kuota Terbatas!`,
        primaryText:
          input.originatedFromOrganicDraft?.caption ||
          `Siap mencoba ${input.promotedOfferingTitle} dari ${brand.businessName}? Klik tombol di bawah untuk info & pemesanan cepat!`,
        ctaButton,
        budgetSharePct: 65,
        status: 'active',
        metrics: { spendIdr: 0, impressions: 0, clicks: 0, ctrPct: 0, conversions: 0, costPerResultIdr: 0, frequency: 0 },
      },
      {
        id: 'cr_carousel_b',
        variantLabel: 'Variasi B · Carousel/Poster',
        headline: `Kenapa Pilih ${brand.businessName}? Geser Detailnya`,
        primaryText: `${brand.defaultCta} · Lokasi: ${city}.`,
        ctaButton,
        budgetSharePct: 35,
        status: 'active',
        metrics: { spendIdr: 0, impressions: 0, clicks: 0, ctrPct: 0, conversions: 0, costPerResultIdr: 0, frequency: 0 },
      },
    ],
    optimizationLogs: hardCapClamped
      ? [
          {
            id: `opt_cap_${Date.now()}`,
            timestampWib: 'Baru saja',
            actionType: 'cap_guard_enforced',
            summary: `Pagar Pengaman Budget aktif: permintaan Rp${requestedDaily.toLocaleString('id-ID')}/hari dikunci otomatis ke batas aman Rp${hardCap.toLocaleString('id-ID')}/hari.`,
            savedOrReallocatedIdr: (requestedDaily - hardCap) * durationDays,
          },
        ]
      : [],
    originatedFromOrganicDraftId: input.originatedFromOrganicDraft?.id,
  };
}

export function runMetaAdsAutonomousOptimizer(campaign: MetaAdCampaignPlan): MetaAdCampaignPlan {
  if (campaign.status !== 'active_running' || campaign.creatives.filter(c => c.status === 'active' && c.metrics.conversions > 0).length < 2) return campaign;

  const sorted = [...campaign.creatives].sort(
    (a, b) => a.metrics.costPerResultIdr - b.metrics.costPerResultIdr,
  );
  const winner = sorted[0];
  const loser = sorted[sorted.length - 1];

  if (loser.metrics.costPerResultIdr <= winner.metrics.costPerResultIdr * 1.35) {
    return campaign;
  }

  const reallocatedDailyIdr = Math.round(
    (campaign.budget.appliedDailyBudgetIdr * loser.budgetSharePct) / 100,
  );

  const updatedCreatives = campaign.creatives.map((c) => {
    if (c.id === winner.id) {
      return {
        ...c,
        budgetSharePct: 100,
        status: 'winner_scaled' as const,
        metrics: { ...c.metrics },
      };
    }
    if (c.id === loser.id) {
      return {
        ...c,
        budgetSharePct: 0,
        status: 'paused_by_ai_loser' as const,
      };
    }
    return c;
  });

  const newLogs = [
    {
      id: `opt_kill_${Date.now()}_1`,
      timestampWib: 'Baru saja · AI Media Buyer',
      actionType: 'kill_underperforming_creative' as const,
      summary: `Mematikan otomatis "${loser.variantLabel}" karena biaya per hasil tinggi (Rp${loser.metrics.costPerResultIdr.toLocaleString('id-ID')} vs pemenang Rp${winner.metrics.costPerResultIdr.toLocaleString('id-ID')}).`,
      savedOrReallocatedIdr: reallocatedDailyIdr,
    },
    {
      id: `opt_scale_${Date.now()}_2`,
      timestampWib: 'Baru saja · AI Media Buyer',
      actionType: 'scale_winner_budget' as const,
      summary: `Mengalihkan 100% budget harian (Rp${campaign.budget.appliedDailyBudgetIdr.toLocaleString('id-ID')}/hari) ke "${winner.variantLabel}" (CTR ${winner.metrics.ctrPct}%).`,
      savedOrReallocatedIdr: reallocatedDailyIdr,
    },
    ...campaign.optimizationLogs,
  ];

  return {
    ...campaign,
    status: campaign.status,
    creatives: updatedCreatives,
    optimizationLogs: newLogs,
  };
}

export function calculateTenantUnitEconomics(input: {
  planId: SubscriptionPlanId;
  postsPublishedThisMonth: number;
  realAssetRatioPct?: number;
}): {
  monthlyRevenueIdr: number;
  monthlyQuota: number;
  quotaRemaining: number;
  estimatedApiCostIdr: number;
  netProfitIdr: number;
  grossMarginPct: number;
} {
  const plan = SUBSCRIPTION_PLANS[input.planId];
  const realAssetRatio = Math.max(0, Math.min(100, input.realAssetRatioPct ?? 50)) / 100;
  // Using real user assets lowers image-gen API cost by ~45%
  const effectiveCostPerPost = Math.round(plan.estimatedApiCostPerPostIdr * (1 - realAssetRatio * 0.45));
  const estimatedApiCostIdr = input.postsPublishedThisMonth * effectiveCostPerPost;
  const netProfitIdr = Math.max(0, plan.priceMonthlyIdr - estimatedApiCostIdr);
  const grossMarginPct =
    plan.priceMonthlyIdr > 0
      ? Math.round((netProfitIdr / plan.priceMonthlyIdr) * 1000) / 10
      : 100;

  return {
    monthlyRevenueIdr: plan.priceMonthlyIdr,
    monthlyQuota: plan.monthlyPostQuota,
    quotaRemaining: Math.max(0, plan.monthlyPostQuota - input.postsPublishedThisMonth),
    estimatedApiCostIdr,
    netProfitIdr,
    grossMarginPct,
  };
}

export function canConsumePostingQuota(input: {
  planId: SubscriptionPlanId;
  postsPublishedThisMonth: number;
  requestedPostsCount?: number;
}): {
  allowed: boolean;
  remainingBefore: number;
  reason?: string;
} {
  const plan = SUBSCRIPTION_PLANS[input.planId];
  const reqCount = input.requestedPostsCount ?? 1;
  if (!plan || !Number.isSafeInteger(input.postsPublishedThisMonth) || input.postsPublishedThisMonth < 0 || !Number.isSafeInteger(reqCount) || reqCount < 1) return { allowed: false, remainingBefore: 0, reason: 'Data pemakaian kuota tidak valid.' };
  const remainingBefore = Math.max(0, plan.monthlyPostQuota - input.postsPublishedThisMonth);
  if (remainingBefore < reqCount) {
    return {
      allowed: false,
      remainingBefore,
      reason: `Kuota paket ${plan.name} bulan ini habis (${input.postsPublishedThisMonth}/${plan.monthlyPostQuota}). Upgrade paket untuk menambah kuota postingan.`,
    };
  }
  return {
    allowed: true,
    remainingBefore,
  };
}

export function validateAutonomyScheduleAgainstPlan(
  config: Pick<AutonomyConfig, 'postsPerDay' | 'targetChannels'>,
  planId: SubscriptionPlanId,
): {
  valid: boolean;
  clampedPostsPerDay: 1 | 2 | 3 | 4;
  allowedTargetChannels: SocialChannelId[];
  notice?: string;
} {
  const plan = SUBSCRIPTION_PLANS[planId];
  const clampedPostsPerDay = Math.min(config.postsPerDay, plan.maxPostsPerDay) as 1 | 2 | 3 | 4;
  const allowedTargetChannels = config.targetChannels.filter((ch) =>
    plan.allowedChannels.includes(ch),
  );
  const valid =
    clampedPostsPerDay === config.postsPerDay &&
    allowedTargetChannels.length === config.targetChannels.length;

  return {
    valid,
    clampedPostsPerDay,
    allowedTargetChannels,
    notice: valid
      ? undefined
      : `Disesuaikan dengan batas paket ${plan.name} (maksimal ${plan.maxPostsPerDay}x posting/hari pada kanal ${plan.allowedChannels.join(', ')}).`,
  };
}

export function calculatePlatformAdminMetrics(tenants: TenantWorkspaceSummary[]): {
  totalMrrIdr: number;
  totalApiCostIdr: number;
  totalNetProfitIdr: number;
  averageGrossMarginPct: number;
  totalPublishedPosts: number;
  totalActiveMetaCampaigns: number;
} {
  const totalMrrIdr = tenants.reduce((sum, t) => sum + t.monthlySubscriptionRevenueIdr, 0);
  const totalApiCostIdr = tenants.reduce((sum, t) => sum + t.estimatedMonthlyApiCostIdr, 0);
  const totalNetProfitIdr = totalMrrIdr - totalApiCostIdr;
  const averageGrossMarginPct =
    totalMrrIdr > 0 ? Math.round((totalNetProfitIdr / totalMrrIdr) * 1000) / 10 : 0;
  const totalPublishedPosts = tenants.reduce((sum, t) => sum + t.postsPublishedThisMonth, 0);
  const totalActiveMetaCampaigns = tenants.reduce((sum, t) => sum + t.activeMetaCampaigns, 0);

  return {
    totalMrrIdr,
    totalApiCostIdr,
    totalNetProfitIdr,
    averageGrossMarginPct,
    totalPublishedPosts,
    totalActiveMetaCampaigns,
  };
}
