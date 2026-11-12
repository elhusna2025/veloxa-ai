import type { VeloxaLocale } from './veloxa-i18n';

type WelcomeCopy = {
  label: string;
  next: string;
  back: string;
  skip: string;
  pause: string;
  play: string;
  slide: string;
  example: string;
  first: [string, string];
  last: [string, string];
};

export const mobileWelcomeCopy: Record<VeloxaLocale, WelcomeCopy> = {
  id: {
    label: 'Selamat datang di Veloxa',
    next: 'Lanjut',
    back: 'Kembali',
    skip: 'Lewati',
    pause: 'Jeda',
    play: 'Putar',
    slide: 'Slide',
    example: 'Contoh',
    first: ['Bikin konten bisnis dari HP', 'Buat post, carousel, dan Reels dengan AI. Terbitkan ke Instagram dan Facebook.'],
    last: ['Siap bikin konten pertama?', 'Mulai dengan satu ide atau produk. Coba buat draf untuk bisnis Anda.'],
  },
  en: {
    label: 'Welcome to Veloxa',
    next: 'Continue',
    back: 'Back',
    skip: 'Skip',
    pause: 'Pause',
    play: 'Play',
    slide: 'Slide',
    example: 'Example',
    first: ['Create business content from your phone', 'Veloxa helps you create and publish posts, carousels, and Reels to Instagram and Facebook.'],
    last: ['Ready to make your first post?', 'Start with one idea or product and create a draft for your business.'],
  },
  es: {
    label: 'Te damos la bienvenida a Veloxa',
    next: 'Continuar',
    back: 'Atrás',
    skip: 'Omitir',
    pause: 'Pausar',
    play: 'Reproducir',
    slide: 'Pantalla',
    example: 'Ejemplo',
    first: ['Crea contenido desde el móvil', 'Veloxa te ayuda a crear y publicar posts, carruseles y Reels en Instagram y Facebook.'],
    last: ['¿Listo para tu primera publicación?', 'Elige una idea o un producto y crea un borrador para tu negocio.'],
  },
  ar: {
    label: 'مرحباً بك في Veloxa',
    next: 'متابعة',
    back: 'رجوع',
    skip: 'تخطي',
    pause: 'إيقاف مؤقت',
    play: 'تشغيل',
    slide: 'الشريحة',
    example: 'مثال',
    first: ['أنشئ محتوى لنشاطك من هاتفك', 'يساعدك Veloxa على إنشاء منشورات ومجموعات صور ومقاطع ريلز ونشرها على إنستغرام وفيسبوك.'],
    last: ['هل أنت مستعد لإنشاء أول منشور؟', 'ابدأ بفكرة أو منتج وأنشئ مسودة لنشاطك التجاري.'],
  },
  ja: {
    label: 'Veloxa へようこそ',
    next: '次へ',
    back: '戻る',
    skip: 'スキップ',
    pause: '一時停止',
    play: '再生',
    slide: 'スライド',
    example: 'サンプル',
    first: ['スマホでビジネスの投稿を作成', 'Veloxa なら Instagram や Facebook 向けの投稿、カルーセル、リールを制作して公開できます。'],
    last: ['最初の投稿を作りましょう', 'アイデアや商品をひとつ選び、ビジネス向けの下書きを作成します。'],
  },
  ko: {
    label: 'Veloxa에 오신 것을 환영합니다',
    next: '계속',
    back: '뒤로',
    skip: '건너뛰기',
    pause: '일시 정지',
    play: '재생',
    slide: '슬라이드',
    example: '예시',
    first: ['휴대폰으로 비즈니스 콘텐츠를 만드세요', 'Veloxa로 게시물, 캐러셀, 릴스를 만들고 인스타그램과 페이스북에 게시하세요.'],
    last: ['첫 게시물을 만들어 볼까요?', '아이디어나 제품을 하나 골라 비즈니스에 맞는 초안을 만드세요.'],
  },
};
