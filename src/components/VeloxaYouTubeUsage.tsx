import type { YouTubeUsageSummary } from '@/lib/youtube-production';

const stages = { script: 'Naskah & revisi', images: 'Gambar & acuan pemeran', voice: 'Narasi & dialog' } as const;
const dollars = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const number = new Intl.NumberFormat('id-ID');

export function VeloxaYouTubeUsage({ usage, sceneCount }: { usage?: YouTubeUsageSummary; sceneCount: number }) {
  const images = usage?.stages.images;
  const entries = Object.entries(usage?.stages ?? {});
  const subtotal = entries.reduce((sum, [, row]) => sum + row.usd, 0);
  const priced = entries.some(([, row]) => row.calls > row.unpriced);
  const missing = entries.reduce((sum, [, row]) => sum + row.unpriced, 0);
  return <details className="min-w-0 rounded-lg border border-neutral-200 p-4">
    <summary className="min-h-11 cursor-pointer font-semibold">Biaya AI video ini{priced ? ' · ' + dollars.format(subtotal) + (usage?.partial || missing ? ' tercatat sebagian' : ' estimasi') : ''}</summary>
    {!entries.length && <p>{usage ? 'Menunggu pemakaian AI pertama yang tercatat.' : 'Rincian pemakaian historis belum tersedia.'}</p>}
    {entries.length > 0 && <>
      <p>Estimasi berdasarkan pemakaian tercatat dan tarif standar sebelum diskon, kuota gratis, atau pajak. Biaya server dan penyimpanan dihitung terpisah.</p>
      {usage?.partial && <p className="mt-2 font-medium">Pencatatan dimulai di tengah produksi. Angka ini hanya mencakup pemakaian sejak saat itu.</p>}
      <dl className="mt-3 space-y-2">{(Object.keys(stages) as (keyof typeof stages)[]).map(key => {
        const row = usage?.stages[key];
        if (!row) return null;
        return <div key={key}><dt className="font-medium">{stages[key]}</dt>
          <dd>{row.calls > row.unpriced ? dollars.format(row.usd) + ' · ' : ''}{number.format(row.calls)} permintaan
            {row.input + row.output > 0 && ' · ' + number.format(row.input) + ' token masuk · ' + number.format(row.output) + ' token keluar'}
            {row.characters > 0 && ' · ' + number.format(row.characters) + ' karakter suara'}</dd></div>;
      })}</dl>
      {usage?.partial && images && images.calls > 0 && !images.unpriced && sceneCount > 0 &&
        <p className="mt-2">Proyeksi gambar untuk {sceneCount} adegan sekitar {dollars.format(sceneCount * images.usd / images.calls)}, dengan satu pembuatan per adegan pada biaya rata-rata yang tercatat.</p>}
      {missing > 0 && <p className="mt-2">{missing} permintaan belum masuk estimasi karena rincian pemakaian atau tarif belum tersedia.</p>}
    </>}
  </details>;
}
