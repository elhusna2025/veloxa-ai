import type { VeloxaLocale } from './veloxa-i18n';

type StepCopy = { label: string; title: string; description: string };
type OnboardingCopy = {
  steps: readonly [StepCopy, StepCopy, StepCopy];
  progress: string;
  done: string;
  businessInfo: string;
  businessName: string;
  city: string;
  preferences: string;
  optional: string;
  audience: string;
  tone: string;
  review: string;
  area: string;
  facebookPage: string;
  trial: string;
  trialDetails: (days: string, posts: string) => string;
  dashboard: string;
  back: string;
  next: string;
  finish: string;
  saving: string;
  sessionLoading: string;
  sessionTitle: string;
  sessionError: string;
  businessRequired: string;
  channelRequired: string;
  saveError: string;
};

export const onboardingCopy: Record<VeloxaLocale, OnboardingCopy> = {
  id: {
    steps: [
      { label: 'Bisnis', title: 'Kenalkan bisnis Anda', description: 'Isi informasi dasar untuk menyiapkan ruang kerja Anda.' },
      { label: 'Kanal', title: 'Pilih kanal konten', description: 'Pilih minimal satu. Anda bisa menghubungkan akun setelah masuk ke dashboard.' },
      { label: 'Paket', title: 'Siap mulai?', description: 'Tinjau pilihan Anda sebelum masuk ke dashboard.' },
    ],
    progress: 'Langkah pengaturan bisnis', done: 'Selesai',
    businessInfo: 'Informasi bisnis', businessName: 'Nama bisnis', city: 'Kota atau area utama',
    preferences: 'Preferensi konten', optional: 'Opsional', audience: 'Target audiens', tone: 'Gaya bahasa',
    review: 'Ringkasan pengaturan', area: 'Area utama', facebookPage: 'Facebook Page', trial: 'Uji coba gratis',
    trialDetails: (days, posts) => `${days} hari · ${posts} publikasi`,
    dashboard: 'Buka dashboard', back: 'Kembali', next: 'Lanjut', finish: 'Simpan & masuk', saving: 'Menyimpan…',
    sessionLoading: 'Memeriksa sesi…', sessionTitle: 'Masuk kembali untuk melanjutkan', sessionError: 'Sesi Anda belum bisa diverifikasi.',
    businessRequired: 'Isi nama bisnis dan kota atau area utama untuk melanjutkan.',
    channelRequired: 'Pilih minimal satu kanal untuk melanjutkan.',
    saveError: 'Pengaturan belum tersimpan. Coba lagi.',
  },
  en: {
    steps: [
      { label: 'Business', title: 'Tell us about your business', description: 'Add the basics to set up your workspace.' },
      { label: 'Channels', title: 'Choose your channels', description: 'Pick at least one. You can connect accounts from the dashboard.' },
      { label: 'Plan', title: 'Ready to get started?', description: 'Review your choices before opening the dashboard.' },
    ],
    progress: 'Business setup steps', done: 'Complete',
    businessInfo: 'Business information', businessName: 'Business name', city: 'City or main area',
    preferences: 'Content preferences', optional: 'Optional', audience: 'Target audience', tone: 'Tone of voice',
    review: 'Setup summary', area: 'Main area', facebookPage: 'Facebook Page', trial: 'Free trial',
    trialDetails: (days, posts) => `${days} days · ${posts} posts`,
    dashboard: 'Open dashboard', back: 'Back', next: 'Continue', finish: 'Save & continue', saving: 'Saving…',
    sessionLoading: 'Checking your session…', sessionTitle: 'Sign in again to continue', sessionError: 'We couldn’t verify your session.',
    businessRequired: 'Enter your business name and city or main area to continue.',
    channelRequired: 'Choose at least one channel to continue.',
    saveError: 'Your settings couldn’t be saved. Try again.',
  },
  es: {
    steps: [
      { label: 'Negocio', title: 'Cuéntanos sobre tu negocio', description: 'Añade los datos básicos para configurar tu espacio de trabajo.' },
      { label: 'Canales', title: 'Elige tus canales', description: 'Elige al menos uno. Podrás conectar tus cuentas desde el panel.' },
      { label: 'Plan', title: '¿Listo para empezar?', description: 'Revisa tus opciones antes de abrir el panel.' },
    ],
    progress: 'Pasos de configuración', done: 'Completado',
    businessInfo: 'Datos del negocio', businessName: 'Nombre del negocio', city: 'Ciudad o zona principal',
    preferences: 'Preferencias de contenido', optional: 'Opcional', audience: 'Público objetivo', tone: 'Tono de voz',
    review: 'Resumen de la configuración', area: 'Zona principal', facebookPage: 'Página de Facebook', trial: 'Prueba gratuita',
    trialDetails: (days, posts) => `${days} días · ${posts} publicaciones`,
    dashboard: 'Abrir panel', back: 'Atrás', next: 'Continuar', finish: 'Guardar y seguir', saving: 'Guardando…',
    sessionLoading: 'Verificando tu sesión…', sessionTitle: 'Vuelve a iniciar sesión', sessionError: 'No pudimos verificar tu sesión.',
    businessRequired: 'Introduce el nombre del negocio y la ciudad o zona principal.',
    channelRequired: 'Elige al menos un canal para continuar.',
    saveError: 'No pudimos guardar tus ajustes. Inténtalo de nuevo.',
  },
  ar: {
    steps: [
      { label: 'النشاط', title: 'عرّفنا على نشاطك التجاري', description: 'أضف المعلومات الأساسية لإعداد مساحة العمل.' },
      { label: 'القنوات', title: 'اختر قنواتك', description: 'اختر قناة واحدة على الأقل. يمكنك ربط الحسابات من لوحة التحكم.' },
      { label: 'الخطة', title: 'هل أنت مستعد للبدء؟', description: 'راجع اختياراتك قبل فتح لوحة التحكم.' },
    ],
    progress: 'خطوات إعداد النشاط التجاري', done: 'مكتمل',
    businessInfo: 'معلومات النشاط التجاري', businessName: 'اسم النشاط التجاري', city: 'المدينة أو المنطقة الرئيسية',
    preferences: 'تفضيلات المحتوى', optional: 'اختياري', audience: 'الجمهور المستهدف', tone: 'أسلوب الخطاب',
    review: 'ملخص الإعدادات', area: 'المنطقة الرئيسية', facebookPage: 'صفحة فيسبوك', trial: 'تجربة مجانية',
    trialDetails: (days, posts) => `${days} أيام · ${posts} منشورات`,
    dashboard: 'فتح لوحة التحكم', back: 'رجوع', next: 'متابعة', finish: 'حفظ ومتابعة', saving: 'جارٍ الحفظ…',
    sessionLoading: 'جارٍ التحقق من الجلسة…', sessionTitle: 'سجّل الدخول مرة أخرى', sessionError: 'تعذّر التحقق من جلستك.',
    businessRequired: 'أدخل اسم النشاط التجاري والمدينة أو المنطقة الرئيسية للمتابعة.',
    channelRequired: 'اختر قناة واحدة على الأقل للمتابعة.',
    saveError: 'تعذّر حفظ إعداداتك. حاول مرة أخرى.',
  },
  ja: {
    steps: [
      { label: '事業', title: '事業について教えてください', description: 'ワークスペースを作成するための基本情報を入力してください。' },
      { label: 'チャネル', title: '投稿先を選択', description: '1つ以上選択してください。アカウントはダッシュボードで連携できます。' },
      { label: 'プラン', title: '準備はできましたか？', description: 'ダッシュボードを開く前に、設定を確認してください。' },
    ],
    progress: '事業設定のステップ', done: '完了',
    businessInfo: '事業情報', businessName: '事業名', city: '都市または主な地域',
    preferences: 'コンテンツの設定', optional: '任意', audience: '対象ユーザー', tone: '文章のトーン',
    review: '設定の確認', area: '主な地域', facebookPage: 'Facebook ページ', trial: '無料トライアル',
    trialDetails: (days, posts) => `${days}日間・${posts}件の投稿`,
    dashboard: 'ダッシュボードを開く', back: '戻る', next: '次へ', finish: '保存して進む', saving: '保存中…',
    sessionLoading: 'セッションを確認中…', sessionTitle: 'もう一度ログインしてください', sessionError: 'セッションを確認できませんでした。',
    businessRequired: '事業名と都市または主な地域を入力してください。',
    channelRequired: '投稿先を1つ以上選択してください。',
    saveError: '設定を保存できませんでした。もう一度お試しください。',
  },
  ko: {
    steps: [
      { label: '비즈니스', title: '비즈니스를 소개해 주세요', description: '워크스페이스를 설정할 기본 정보를 입력하세요.' },
      { label: '채널', title: '게시 채널을 선택하세요', description: '한 개 이상 선택하세요. 계정은 대시보드에서 연결할 수 있습니다.' },
      { label: '요금제', title: '시작할 준비가 되셨나요?', description: '대시보드를 열기 전에 설정을 확인하세요.' },
    ],
    progress: '비즈니스 설정 단계', done: '완료',
    businessInfo: '비즈니스 정보', businessName: '비즈니스 이름', city: '도시 또는 주요 지역',
    preferences: '콘텐츠 설정', optional: '선택 사항', audience: '대상 고객', tone: '문체',
    review: '설정 요약', area: '주요 지역', facebookPage: 'Facebook 페이지', trial: '무료 체험',
    trialDetails: (days, posts) => `${days}일 · 게시물 ${posts}개`,
    dashboard: '대시보드 열기', back: '이전', next: '계속', finish: '저장하고 계속', saving: '저장 중…',
    sessionLoading: '세션 확인 중…', sessionTitle: '다시 로그인해 주세요', sessionError: '세션을 확인할 수 없습니다.',
    businessRequired: '비즈니스 이름과 도시 또는 주요 지역을 입력하세요.',
    channelRequired: '계속하려면 채널을 한 개 이상 선택하세요.',
    saveError: '설정을 저장하지 못했습니다. 다시 시도하세요.',
  },
};
