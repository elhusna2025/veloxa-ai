'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VeloxaSelect } from './VeloxaSelect';
import { VeloxaYouTubePublish } from './VeloxaYouTubePublish';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { productionResources, productionStageLabel, youtubeProductionSettings, youtubeVoices, type YouTubeProduction, type YouTubeProductionSettings, type YouTubeScriptBlock } from '@/lib/youtube-production';

type Props = { workspaceId: string; businessId: string; businessName: string; ready: boolean; onBusyChange: (value: boolean) => void; onDirtyChange: (value: boolean) => void; onManageConnection: () => void; reviewStatus?: 'authorized' | 'failed' | null };
const panel = 'veloxa-panel min-w-0 space-y-5 p-4 sm:p-6';
const field = 'min-h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-white p-3 text-base focus-visible:outline-2 focus-visible:outline-[#a92e5d]';
const primary = 'veloxa-button-primary min-h-11 text-base disabled:opacity-50';
const secondary = 'veloxa-button-secondary min-h-11 text-base disabled:opacity-50';
const defaults: YouTubeProductionSettings = { kind: 'short', minutes: 1, topic: '', direction: '', voice: 'marin', delivery: 'Percakapan Indonesia yang hangat dan ekspresif, dengan jeda singkat dan penekanan alami.', characters: [] };
const active = (item: YouTubeProduction) => ['planning', 'scripting', 'characters', 'producing'].includes(item.state);
const Label = ({ title, children }: { title: string; children: React.ReactNode }) => <label className="block space-y-2"><span className="text-sm font-medium">{title}</span>{children}</label>;

export function VeloxaYouTubeProductionStudio(props: Props) {
  const query = useMemo(() => new URLSearchParams({ workspaceId: props.workspaceId, businessId: props.businessId }).toString(), [props.workspaceId, props.businessId]);
  const endpoint = useCallback((id = '', media = false) => `/api/veloxa/youtube/productions/${id ? id + '/' : ''}${media ? 'media/' : ''}?${query}`, [query]);
  const [settings, setSettings] = useState<YouTubeProductionSettings>(defaults);
  const [productions, setProductions] = useState<YouTubeProduction[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<YouTubeScriptBlock | null>(null);
  const [actorEdit, setActorEdit] = useState<YouTubeProductionSettings['characters'][number] | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [viewer, setViewer] = useState('');
  const [publishDirty, setPublishDirty] = useState(false);
  const current = productions.find(item => item.id === selected);
  const currentId = current?.id, currentState = current?.state;
  const pending = useRef<{ id: string; body: string } | null>(null);
  const { onBusyChange, onDirtyChange } = props;
  const apply = useCallback((item: YouTubeProduction) => setProductions(items => {
    if ((items.find(saved => saved.id === item.id)?.revision ?? 0) > item.revision) return items;
    return [item, ...items.filter(saved => saved.id !== item.id)].sort((a, b) => b.createdAt - a.createdAt);
  }), []);
  useEffect(() => { onBusyChange(Boolean(busy)); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const dirty = Boolean(editing) || Boolean(actorEdit) || publishDirty || !selected && JSON.stringify(settings) !== JSON.stringify(defaults);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController(); if (!props.ready) return;
    setLoading(true);
    void veloxaApi<{ productions: YouTubeProduction[] }>(endpoint(), { signal: controller.signal, redirect: 'error' })
      .then(result => { if (!controller.signal.aborted) { setProductions(result.productions); setSelected(result.productions[0]?.id ?? null); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, props.ready]);
  useEffect(() => {
    if (!currentId || !currentState || !['planning', 'scripting', 'characters', 'producing'].includes(currentState)) return;
    const controller = new AbortController(); let running = false;
    const poll = async () => {
      if (running || controller.signal.aborted) return; running = true;
      try {
        const latest = await veloxaApi<{ production: YouTubeProduction }>(endpoint(currentId), { signal: controller.signal, redirect: 'error' });
        if (!controller.signal.aborted) apply(latest.production);
        if (active(latest.production) && (!latest.production.retryAt || latest.production.retryAt <= Date.now())) {
          const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(currentId), { method: 'POST', body: JSON.stringify({ action: 'process' }), signal: controller.signal, redirect: 'error' });
          if (!controller.signal.aborted) { apply(result.production); setError(''); }
        }
      } catch { if (!controller.signal.aborted) setError('Pemeriksaan koneksi terputus. Produksi yang sama tetap tersimpan dan akan diperiksa kembali.'); }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 4000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [currentId, currentState, endpoint, apply]);
  useEffect(() => {
    setViewer(''); if (!currentId || !currentState || !['character_review', 'producing', 'ready'].includes(currentState)) return;
    const controller = new AbortController();
    const refresh = () => veloxaApi(endpoint(currentId, true), { method: 'POST', signal: controller.signal, redirect: 'error' }).then(() => { if (!controller.signal.aborted) setViewer(endpoint(currentId, true)); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    void refresh(); const timer = setInterval(() => { void refresh(); }, 20 * 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [currentId, currentState, endpoint]);
  async function run(label: string, fn: () => Promise<void>) { if (busy) return; setBusy(label); setError(''); try { await fn(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Permintaan belum selesai.'); } finally { setBusy(''); } }
  function create() { void run('Menyimpan rencana…', async () => {
    const parsed = youtubeProductionSettings.parse(settings), body = JSON.stringify(parsed);
    if (!pending.current || pending.current.body !== body) pending.current = { id: crypto.randomUUID(), body };
    const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(), { method: 'POST', body: JSON.stringify({ id: pending.current.id, settings: parsed }), redirect: 'error' });
    apply(result.production); setSelected(result.production.id); setSettings(defaults); pending.current = null;
  }); }
  function action(value: 'approve_script' | 'approve_characters' | 'stop' | 'resume') { if (!current) return; void run('Menyimpan pilihan…', async () => {
    const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(current.id), { method: 'POST', body: JSON.stringify({ action: value, revision: current.revision, confirmed: true }), redirect: 'error' }); apply(result.production);
  }); }
  function character(id: string, patch: Partial<YouTubeProductionSettings['characters'][number]>) { setSettings(value => ({ ...value, characters: value.characters.map(actor => actor.id === id ? { ...actor, ...patch } : actor) })); }
  function saveScript() { if (!current || !editing) return; void run('Menyimpan naskah…', async () => {
    const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(current.id), { method: 'POST', body: JSON.stringify({ action: 'edit', revision: current.revision, index: editing.index, block: { scenes: editing.scenes } }), redirect: 'error' }); apply(result.production); setEditing(null);
  }); }
  function reviseCharacter() { if (!current || !actorEdit) return; void run('Memperbarui acuan pemeran…', async () => {
    const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(current.id), { method: 'POST', redirect: 'error', body: JSON.stringify({ action: 'revise_character', revision: current.revision, characterId: actorEdit.id, appearance: actorEdit.appearance, voice: actorEdit.voice, delivery: actorEdit.delivery, confirmed: true }) });
    apply(result.production); setActorEdit(null);
  }); }
  const resources = productionResources(current?.settings ?? settings);
  const media = (name: string) => viewer + '&name=' + encodeURIComponent(name);
  const voiceSelect = (value: string, change: (voice: YouTubeProductionSettings['voice']) => void, label: string) => <VeloxaSelect aria-label={label} value={value} onValueChange={voice => change(voice as YouTubeProductionSettings['voice'])}>{youtubeVoices.map(voice => <option key={voice} value={voice}>{voice}</option>)}</VeloxaSelect>;
  return <div className="min-w-0 space-y-6" data-testid="youtube-production-studio">
    <section className={panel}><p className="text-sm font-medium text-[#a92e5d]">{props.businessName}</p><h2 className="text-xl font-semibold">Studio video AI</h2><p className="text-base text-neutral-600">Dari ide dan naskah menjadi gambar bergerak, dialog, dan video siap terbit.</p><ol className="grid gap-2 text-sm text-neutral-600 sm:grid-cols-4">{['Topik & durasi', 'Naskah & pemeran', 'Gambar, gerak & suara', 'Tinjau & terbitkan'].map((label, i) => <li key={label}>{i + 1}. {label}</li>)}</ol></section>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-base text-red-800">{error}</p>}
    {loading ? <p role="status" className={panel}>Memuat produksi tersimpan…</p> : !current ? <section className={panel}>
      <div role="group" aria-label="Jenis video" className="grid gap-3 sm:grid-cols-2">{(['short', 'video'] as const).map(kind => <button type="button" key={kind} aria-pressed={settings.kind === kind} onClick={() => setSettings(value => ({ ...value, kind, minutes: kind === 'short' ? 1 : 15 }))} className={`${secondary} text-start ${settings.kind === kind ? 'border-[#bd416e] bg-[#faf2f5] text-[#682943]' : ''}`}>{kind === 'short' ? 'YouTube Shorts · 9:16' : 'Video YouTube · 16:9'}</button>)}</div>
      <div className="grid gap-5 sm:grid-cols-2"><Label title="Target durasi">{settings.kind === 'short' ? <p className={field}>1 menit</p> : <><VeloxaSelect aria-label="Target durasi" value={[15, 30, 60].includes(settings.minutes) ? settings.minutes : 'custom'} onValueChange={value => setSettings(item => ({ ...item, minutes: value === 'custom' ? 90 : Number(value) }))}><option value="15">15 menit</option><option value="30">30 menit</option><option value="60">60 menit</option><option value="custom">Durasi lain</option></VeloxaSelect>{![15, 30, 60].includes(settings.minutes) && <input aria-label="Durasi dalam menit (1–120)" type="number" min={1} max={120} value={settings.minutes} onChange={event => setSettings(value => ({ ...value, minutes: Number(event.target.value) }))} className={field} />}</>}</Label><Label title="Suara narator">{voiceSelect(settings.voice, voice => setSettings(value => ({ ...value, voice })), 'Suara narator')}</Label></div>
      <Label title="Video ini membahas apa?"><textarea rows={4} maxLength={4000} value={settings.topic} onChange={event => setSettings(value => ({ ...value, topic: event.target.value }))} placeholder="Topik, tujuan, siapa penontonnya, dan hal penting yang perlu dibahas." className={field} /></Label>
      <Label title="Arahan visual (opsional)"><textarea rows={2} maxLength={2000} value={settings.direction} onChange={event => setSettings(value => ({ ...value, direction: event.target.value }))} placeholder="Suasana dan gaya adegan. Palet mengikuti DNA bisnis tersimpan." className={field} /></Label>
      <Label title="Pembawaan narator"><textarea rows={2} maxLength={800} value={settings.delivery} onChange={event => setSettings(value => ({ ...value, delivery: event.target.value }))} className={field} /></Label>
      <div className="space-y-4 border-t pt-5"><h3 className="text-lg font-semibold">Pemeran (opsional)</h3><p className="text-sm text-neutral-600">Satu gambar acuan dan suara tetap untuk setiap karakter. Maksimal lima pemeran.</p>{settings.characters.map((actor, index) => <fieldset key={actor.id} className="min-w-0 space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm font-semibold">Karakter {index + 1}</legend><Label title="Nama"><input className={field} maxLength={60} value={actor.name} onChange={event => character(actor.id, { name: event.target.value })} /></Label><Label title="Ciri wajah, rambut, usia dan pakaian"><textarea rows={3} className={field} value={actor.appearance} maxLength={1000} onChange={event => character(actor.id, { appearance: event.target.value })} /></Label><Label title="Suara tetap">{voiceSelect(actor.voice, voice => character(actor.id, { voice }), `Suara karakter ${index + 1}`)}</Label><Label title="Gaya bicara"><textarea rows={2} className={field} value={actor.delivery} maxLength={500} onChange={event => character(actor.id, { delivery: event.target.value })} /></Label><button type="button" className={secondary} onClick={() => setSettings(value => ({ ...value, characters: value.characters.filter(item => item.id !== actor.id) }))}>Hapus karakter {index + 1}</button></fieldset>)}<button type="button" disabled={settings.characters.length >= 5} className={secondary} onClick={() => { const id = [1, 2, 3, 4, 5].find(i => !settings.characters.some(actor => actor.id === `actor_${i}`))!; setSettings(value => ({ ...value, characters: [...value.characters, { id: `actor_${id}`, name: '', appearance: '', voice: youtubeVoices[id], delivery: '' }] })); }}>Tambah karakter</button></div>
      <p className="rounded-lg bg-[#faf2f5] p-4 text-base text-[#682943]">Target {resources.minutes} menit · {resources.scenes} adegan · sekitar {resources.minWords.toLocaleString('id-ID')}–{resources.maxWords.toLocaleString('id-ID')} kata. Gambar dan suara dibuat setelah naskah ditinjau.</p><p className="text-sm text-neutral-600">Suara menggunakan AI. Pilihan suara dan pembawaan belum meniru rekaman suara pribadi.</p><button type="button" className={primary} disabled={Boolean(busy) || !props.ready || !youtubeProductionSettings.safeParse(settings).success} onClick={create}>{busy || 'Susun naskah dengan AI'}</button>
    </section> : <>
      <section className={panel}><p className="text-sm font-medium text-[#a92e5d]">{productionStageLabel[current.state]}</p><h3 className="text-xl font-semibold">{current.outline?.title || current.settings.topic}</h3><p>{current.settings.minutes} menit · {current.settings.kind === 'short' ? '9:16' : '16:9'}</p>
        {active(current) && <div role="status"><p>{current.state === 'scripting' ? `${current.blocks.length} dari ${current.settings.minutes} menit naskah tersimpan.` : current.state === 'producing' ? `${current.completedScenes} dari ${resources.scenes} adegan video tersimpan.` : productionStageLabel[current.state]}</p><p className="mt-2 text-sm text-neutral-500">Proses tersimpan dan dapat dilanjutkan saat kembali ke Studio.</p></div>}
        {current.message && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{current.message}</p>}
        {current.settings.characters.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{current.settings.characters.map(actor => <article key={actor.id} className="min-w-0 rounded-lg border p-3">{viewer && current.portraits?.includes(actor.id) && <img src={media(actor.id + '.jpg')} alt={`Acuan tetap ${actor.name}`} className="mb-3 aspect-square w-full rounded-lg object-cover" />}<p className="font-semibold">{actor.name}</p><p className="mt-1 text-sm text-neutral-600">Suara: {actor.voice}</p>{viewer && current.portraits?.includes(actor.id) && <audio controls preload="none" aria-label={`Contoh suara ${actor.name}`} src={media(actor.id + '.wav')} className="mt-3 w-full min-w-0" />}<p className="mt-1 break-words text-sm text-neutral-600">{actor.appearance}</p>{current.state === 'character_review' && <button type="button" className={secondary + ' mt-3'} disabled={Boolean(busy) || Boolean(actorEdit)} onClick={() => setActorEdit({ ...actor })}>Perbaiki {actor.name}</button>}</article>)}</div>}
        {actorEdit && <fieldset className="min-w-0 space-y-3 rounded-lg border p-4"><legend>Perubahan belum disimpan · {actorEdit.name}</legend><Label title="Penampilan tetap"><textarea className={field} rows={3} value={actorEdit.appearance} onChange={event => setActorEdit(value => value ? { ...value, appearance: event.target.value } : value)} /></Label><Label title="Suara tetap">{voiceSelect(actorEdit.voice, voice => setActorEdit(value => value ? { ...value, voice } : value), 'Suara karakter yang diperbaiki')}</Label><Label title="Pembawaan suara"><textarea className={field} rows={2} value={actorEdit.delivery} onChange={event => setActorEdit(value => value ? { ...value, delivery: event.target.value } : value)} /></Label><div className="flex flex-wrap gap-3"><button className={primary} disabled={Boolean(busy)} onClick={reviseCharacter}>Buat ulang acuan karakter ini</button><button className={secondary} disabled={Boolean(busy)} onClick={() => setActorEdit(null)}>Batalkan perubahan</button></div></fieldset>}{current.state === 'character_review' && <><p>Tinjau wajah dan identitas semua pemeran. Acuan yang sama dipakai di setiap adegan terkait.</p><button disabled={Boolean(busy) || Boolean(actorEdit)} className={primary} onClick={() => action('approve_characters')}>Gunakan pemeran ini & produksi video</button></>}
        {current.state === 'script_review' && <><p>Produksi akan membuat {resources.scenes} gambar, {resources.minutes} menit dialog, serta animasi kamera.</p><button disabled={Boolean(busy) || Boolean(editing)} className={primary} onClick={() => action('approve_script')}>{current.settings.characters.length ? 'Naskah sesuai · buat acuan pemeran' : 'Naskah sesuai · produksi video'}</button></>}
        {current.state === 'attention' && <button disabled={Boolean(busy)} className={primary} onClick={() => action('resume')}>Lanjutkan produksi yang sama</button>}
        {!['ready', 'cancelled'].includes(current.state) && <button disabled={Boolean(busy)} className={secondary} onClick={() => action('stop')}>Hentikan produksi</button>}
        {['ready', 'cancelled'].includes(current.state) && <button disabled={Boolean(editing) || Boolean(actorEdit) || Boolean(busy) || publishDirty} className={secondary} onClick={() => setSelected(null)}>Buat video baru</button>}
      </section>
      {current.blocks.length > 0 && <section className={panel}><h3 className="text-lg font-semibold">Naskah & urutan adegan</h3>{current.blocks.map(block => <details key={block.index} className="min-w-0 border-t pt-4"><summary className="min-h-11 cursor-pointer font-medium">Menit {block.index + 1} · {block.chapter}</summary><div className="space-y-4 py-3">{block.scenes.map((scene, index) => <div key={index} className="space-y-2"><h4 className="font-semibold">{index + 1}. {scene.title}</h4><p className="text-sm text-neutral-600">{scene.supporting}</p>{scene.lines.map((line, i) => <p key={i}><span className="font-medium">{line.speakerId === 'narrator' ? 'Narator' : current.settings.characters.find(actor => actor.id === line.speakerId)?.name}: </span>{line.text}</p>)}<p className="text-sm text-neutral-500">Visual: {scene.visual}</p></div>)}{current.state === 'script_review' && <button disabled={Boolean(editing) || Boolean(busy)} className={secondary} onClick={() => setEditing(structuredClone(block))}>Edit menit {block.index + 1}</button>}</div></details>)}</section>}
      {editing && <section className={panel}><h3 className="text-lg font-semibold">Perubahan belum disimpan · menit {editing.index + 1}</h3>{editing.scenes.map((scene, index) => <fieldset key={index} className="min-w-0 space-y-3 border-t pt-4"><legend>Adegan {index + 1}</legend>{(['title', 'supporting', 'visual'] as const).map(key => <Label key={key} title={{ title: 'Judul', supporting: 'Teks pendukung', visual: 'Arahan foto' }[key]}><textarea className={field} rows={2} value={scene[key]} onChange={event => setEditing(value => value ? { ...value, scenes: value.scenes.map((s, i) => i === index ? { ...s, [key]: event.target.value } : s) } : null)} /></Label>)}{scene.lines.map((line, lineIndex) => <Label key={lineIndex} title={`Dialog ${lineIndex + 1} · ${line.speakerId === 'narrator' ? 'Narator' : current.settings.characters.find(actor => actor.id === line.speakerId)?.name}`}><textarea className={field} rows={3} value={line.text} onChange={event => setEditing(value => value ? { ...value, scenes: value.scenes.map((s, i) => { if (i !== index) return s; const lines = s.lines.map((l, j) => j === lineIndex ? { ...l, text: event.target.value } : l); return { ...s, lines, narration: lines.map(l => l.text).join(' ') }; }) } : null)} /></Label>)}</fieldset>)}<p className="text-sm text-neutral-600">Pertahankan 105–125 kata narasi per menit untuk pembawaan alami.</p><div className="flex flex-wrap gap-3"><button disabled={Boolean(busy)} className={primary} onClick={saveScript}>Simpan naskah</button><button disabled={Boolean(busy)} className={secondary} onClick={() => setEditing(null)}>Batalkan perubahan</button></div></section>}
      {current.state === 'ready' && <><section className={panel}><h3 className="text-lg font-semibold">Tinjau video akhir</h3>{viewer ? <><video src={media('final.mp4')} controls playsInline preload="metadata" className={`mx-auto w-full rounded-lg bg-neutral-950 ${current.settings.kind === 'short' ? 'max-w-sm' : ''}`} /><p className="text-sm text-neutral-600">Durasi render: {current.durationSeconds?.toLocaleString('id-ID')} detik · suara AI</p><a className={secondary} href={media('final.mp4') + '&download=1'}>Unduh MP4</a></> : <p role="status">Menyiapkan pratinjau privat…</p>}</section><VeloxaYouTubePublish {...props} production={current} onDirtyChange={setPublishDirty} /></>}
    </>}
    {productions.length > 0 && <section className={panel}><h3 className="text-lg font-semibold">Produksi tersimpan</h3>{productions.map(item => <button type="button" key={item.id} disabled={Boolean(editing) || Boolean(actorEdit) || Boolean(busy) || publishDirty} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setError(''); }} className={`${secondary} flex w-full min-w-0 flex-col items-start text-start`}><span className="break-words font-semibold">{item.outline?.title || item.settings.topic}</span><span className="mt-1 text-sm text-neutral-600">{productionStageLabel[item.state]} · {item.settings.minutes} menit</span></button>)}</section>}
  </div>;
}
