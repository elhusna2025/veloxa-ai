import type { VeloxaLocale } from './veloxa-i18n';

type WorkflowCopy = {
  title: [string, string];
  description: string;
  demo: string;
  play: string;
  pause: string;
  replay: string;
  steps: [string, string, string, string];
  screens: [[string, string], [string, string], [string, string], [string, string]];
  connected: string;
  caption: string;
  manual: [string, string];
  automatic: [string, string];
  availability: string;
  published: string;
};

export const workflowCopy: Record<VeloxaLocale, WorkflowCopy> = {
  id: {
    title: ['Buat dan terbitkan konten', 'dari satu tempat.'],
    description: 'Hubungkan Instagram profesional atau Facebook Page lewat Meta. Pilih produk atau tulis ide, lalu AI membuat visual dan caption. Tinjau dan terbitkan langsung dari HP.',
    demo: 'Demo cara kerja',
    play: 'Putar demo',
    pause: 'Jeda demo',
    replay: 'Putar ulang',
    steps: ['Hubungkan', 'Buat konten', 'Atur terbit', 'Lihat hasil'],
    screens: [
      ['Hubungkan akun bisnis', 'Pilih akun yang Anda kelola, lalu izinkan Veloxa menerbitkan konten melalui Meta.'],
      ['Ubah produk jadi postingan', 'Pilih Es Kopi Gula Aren. AI menyiapkan gambar dan caption untuk postingan pertama Anda.'],
      ['Pilih cara menerbitkan', 'Tinjau postingan ini untuk terbit langsung, atau atur jadwal rutin dan aktifkan mode otomatis.'],
      ['Konten muncul di akun tujuan', 'Veloxa menampilkan status setelah platform mengonfirmasi kiriman.'],
    ],
    connected: 'Terhubung setelah izin diberikan',
    caption: 'Sore terasa lebih pelan dengan Es Kopi Gula Aren. Mampir dan nikmati satu gelas di Rona Coffee.',
    manual: ['Tinjau & terbitkan', 'Periksa draf, lalu tekan Terbitkan.'],
    automatic: ['Jadwal otomatis', 'Contoh: Senin dan Kamis, pukul 18.00 WIB. Setelah diaktifkan, AI membuat dan menerbitkan konten sesuai aturan.'],
    availability: 'Mode otomatis memerlukan penjadwal Veloxa yang aktif.',
    published: 'Terbit di Instagram',
  },
  en: {
    title: ['Create and publish content', 'in one place.'],
    description: 'Connect a professional Instagram account or Facebook Page through Meta. Pick a product or enter an idea, then let AI create the visuals and caption. Review and publish from your phone.',
    demo: 'Workflow demo', play: 'Play demo', pause: 'Pause demo', replay: 'Replay demo',
    steps: ['Connect', 'Create', 'Choose when', 'See result'],
    screens: [
      ['Connect a business account', 'Choose an account you manage and grant Veloxa publishing access through Meta.'],
      ['Turn a product into a post', 'Select the iced palm sugar latte. AI prepares an image and caption for your first post.'],
      ['Choose how to publish', 'Review this post and publish it now, or set a recurring schedule and turn on automatic publishing.'],
      ['See the post on your account', 'Veloxa shows the status once the platform confirms publication.'],
    ],
    connected: 'Connected after permission',
    caption: 'Take the afternoon slowly with an iced palm sugar latte. Stop by Rona Coffee for a glass.',
    manual: ['Review and publish', 'Check the draft, then select Publish.'],
    automatic: ['Automatic schedule', 'Example: Mondays and Thursdays at 6 p.m. Once enabled, AI creates and publishes content on your schedule.'],
    availability: 'Automatic publishing requires an active Veloxa scheduler.',
    published: 'Published on Instagram',
  },
  es: {
    title: ['Crea y publica contenido', 'desde un solo lugar.'],
    description: 'Conecta tu cuenta profesional de Instagram o página de Facebook a través de Meta. Elige un producto o escribe una idea. La IA prepara la imagen y el texto para que revises y publiques desde el móvil.',
    demo: 'Demostración', play: 'Reproducir', pause: 'Pausar', replay: 'Volver a ver',
    steps: ['Conecta', 'Crea', 'Programa', 'Ver resultado'],
    screens: [
      ['Conecta tu cuenta de empresa', 'Elige una cuenta que administras y concede permisos de publicación a través de Meta.'],
      ['Convierte un producto en una publicación', 'Elige el café helado con azúcar de palma. La IA prepara la imagen y el texto.'],
      ['Elige cómo publicar', 'Revisa esta publicación y compártela ahora, o configura un horario recurrente y activa la publicación automática.'],
      ['Ve el resultado en tu cuenta', 'Veloxa muestra el estado cuando la plataforma confirma la publicación.'],
    ],
    connected: 'Conectada tras conceder permisos',
    caption: 'Tómate la tarde con calma con un café helado con azúcar de palma. Te esperamos en Rona Coffee.',
    manual: ['Revisar y publicar', 'Revisa el borrador y pulsa Publicar.'],
    automatic: ['Horario automático', 'Por ejemplo, lunes y jueves a las 18:00. Al activarlo, la IA crea y publica según tus reglas.'],
    availability: 'La publicación automática requiere que el programador de Veloxa esté activo.',
    published: 'Publicado en Instagram',
  },
  ar: {
    title: ['أنشئ المحتوى وانشره', 'من مكان واحد.'],
    description: 'اربط حساب إنستغرام احترافياً أو صفحة فيسبوك عبر Meta. اختر منتجاً أو اكتب فكرة، وسيعد الذكاء الاصطناعي الصورة والنص. راجع المحتوى وانشره من هاتفك.',
    demo: 'عرض توضيحي', play: 'شغّل العرض', pause: 'أوقف العرض مؤقتاً', replay: 'أعد تشغيل العرض',
    steps: ['اربط الحساب', 'أنشئ المحتوى', 'حدد النشر', 'شاهد النتيجة'],
    screens: [
      ['اربط حساب نشاطك التجاري', 'اختر حساباً تديره وامنح Veloxa إذن النشر عبر Meta.'],
      ['حوّل منتجاً إلى منشور', 'اختر قهوة مثلجة بسكر النخيل. يعدّ الذكاء الاصطناعي الصورة والنص للمنشور.'],
      ['اختر طريقة النشر', 'راجع المنشور وانشره الآن، أو اضبط جدولاً متكرراً وفعّل النشر التلقائي.'],
      ['شاهد المنشور في حسابك', 'يعرض Veloxa حالة المنشور بعد تأكيد النشر من المنصة.'],
    ],
    connected: 'تم الربط بعد منح الإذن',
    caption: 'استمتع بظهيرة هادئة مع قهوة مثلجة بسكر النخيل. تفضل بزيارتنا في Rona Coffee.',
    manual: ['راجع وانشر', 'تحقق من المسودة ثم اضغط على نشر.'],
    automatic: ['الجدولة التلقائية', 'مثلاً الاثنين والخميس الساعة السادسة مساءً. بعد التفعيل، ينشئ الذكاء الاصطناعي المحتوى وينشره وفق قواعدك.'],
    availability: 'يتطلب النشر التلقائي تشغيل نظام الجدولة في Veloxa.',
    published: 'نُشر على إنستغرام',
  },
  ja: {
    title: ['コンテンツ制作から投稿まで、', 'ひとつの場所で。'],
    description: 'Meta 経由で Instagram のプロアカウントや Facebook ページを連携。商品やアイデアをもとに AI が画像とキャプションを作成し、スマホから確認・投稿できます。',
    demo: '使い方のデモ', play: 'デモを再生', pause: '一時停止', replay: 'もう一度見る',
    steps: ['連携', '制作', '公開設定', '公開結果'],
    screens: [
      ['ビジネスアカウントを連携', '管理しているアカウントを選び、Meta で Veloxa に投稿権限を付与します。'],
      ['商品を投稿に', 'ヤシ糖入りのアイスラテを選択。AI が投稿用の画像とキャプションを作成します。'],
      ['公開方法を選ぶ', 'この投稿を確認して今すぐ公開するか、定期スケジュールを設定して自動投稿を有効にします。'],
      ['公開先で投稿を確認', 'SNS が投稿を確認すると、Veloxa にステータスが表示されます。'],
    ],
    connected: '許可後に連携済み',
    caption: 'ヤシ糖入りのアイスラテで午後のひと息。Rona Coffee でお待ちしています。',
    manual: ['確認して投稿', '下書きを確認し、公開を選びます。'],
    automatic: ['自動投稿スケジュール', '例：毎週月曜と木曜の18時。有効にすると、AI が設定したルールで制作・投稿します。'],
    availability: '自動投稿には Veloxa のスケジューラーが稼働している必要があります。',
    published: 'Instagram に投稿済み',
  },
  ko: {
    title: ['콘텐츠 제작부터 게시까지', '한 곳에서.'],
    description: 'Meta를 통해 인스타그램 프로 계정이나 페이스북 페이지를 연결하세요. 제품이나 아이디어를 선택하면 AI가 이미지와 문구를 만들고, 휴대폰에서 확인하고 게시할 수 있습니다.',
    demo: '사용 방법 데모', play: '데모 재생', pause: '일시정지', replay: '다시 보기',
    steps: ['연결', '콘텐츠 제작', '게시 설정', '결과 보기'],
    screens: [
      ['비즈니스 계정 연결', '관리하는 계정을 선택한 뒤 Meta에서 Veloxa에 게시 권한을 부여하세요.'],
      ['제품을 게시물로 만들기', '팜슈거 아이스 라테를 선택하면 AI가 게시물의 이미지와 문구를 만듭니다.'],
      ['게시 방법 선택', '게시물을 검토하고 바로 게시하거나, 반복 일정을 설정해 자동 게시를 켜세요.'],
      ['연결된 계정에서 결과 확인', '플랫폼이 게시를 확인하면 Veloxa에 상태가 표시됩니다.'],
    ],
    connected: '권한 부여 후 연결됨',
    caption: '팜슈거 아이스 라테와 여유로운 오후 한 잔. Rona Coffee에서 만나세요.',
    manual: ['검토하고 게시', '초안을 확인하고 게시를 누르세요.'],
    automatic: ['자동 게시 일정', '예: 월요일과 목요일 오후 6시. 기능을 켜면 AI가 규칙에 맞춰 콘텐츠를 만들고 게시합니다.'],
    availability: '자동 게시를 하려면 Veloxa의 예약 기능이 활성화되어 있어야 합니다.',
    published: '인스타그램에 게시됨',
  },
};
