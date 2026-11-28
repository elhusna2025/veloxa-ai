'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VeloxaSelect } from './VeloxaSelect';
import { VeloxaYouTubePublish } from './VeloxaYouTubePublish';
import { VeloxaYouTubeProgress } from './VeloxaYouTubeProgress';
import { VeloxaYouTubeSceneGallery } from './VeloxaYouTubeSceneGallery';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { productionResources, productionStageLabel, segmentYouTubeNarration, youtubeProductionSettings, youtubeVoices, youtubeStoryGenres, youtubeGenreLabels, type YouTubeStoryGenre, type YouTubeProduction, type YouTubeProductionSettings, type YouTubeScriptBlock } from '@/lib/youtube-production';

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
  const [revisionNote, setRevisionNote] = useState('');
  const [proposal, setProposal] = useState<YouTubeScriptBlock | null>(null);
  const [revisionError, setRevisionError] = useState('');
  const [actorEdit, setActorEdit] = useState<YouTubeProductionSettings['characters'][number] | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true), [viewer, setViewer] = useState('');
  const [publishDirty, setPublishDirty] = useState(false);
  const current = productions.find(item => item.id === selected);
  const currentId = current?.id, currentState = current?.state;
  const pending = useRef<{ id: string; body: string } | null>(null);
  const newVideoHeading = useRef<HTMLHeadingElement>(null), focusNewVideo = useRef(false);
  const navigationLocked = Boolean(editing) || Boolean(actorEdit) || Boolean(busy) || publishDirty;
  const { onBusyChange, onDirtyChange } = props;
  const apply = useCallback((item: YouTubeProduction) => setProductions(items => {
    if ((items.find(saved => saved.id === item.id)?.revision ?? 0) > item.revision) return items;
    return [item, ...items.filter(saved => saved.id !== item.id)].sort((a, b) => b.createdAt - a.createdAt);
  }), []);
  useEffect(() => { onBusyChange(Boolean(busy)); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const dirty = Boolean(editing) || Boolean(actorEdit) || publishDirty || !selected && JSON.stringify(settings) !== JSON.stringify({ ...defaults, voice: productions[0]?.settings.voice ?? defaults.voice });
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (loading || selected || !focusNewVideo.current) return;
    focusNewVideo.current = false;
    newVideoHeading.current?.focus({ preventScroll: true });
    newVideoHeading.current?.scrollIntoView({ block: 'start' });
  }, [loading, selected]);
  useEffect(() => {
    const controller = new AbortController(); if (!props.ready) return;
    setLoading(true);
    void veloxaApi<{ productions: YouTubeProduction[] }>(endpoint(), { signal: controller.signal, redirect: 'error' })
      .then(result => { if (!controller.signal.aborted) { setProductions(result.productions); setSelected(result.productions[0]?.id ?? null); setSettings({ ...defaults, voice: result.productions[0]?.settings.voice ?? defaults.voice }); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, props.ready]);
  useEffect(() => {
    if (!currentId || !currentState || !['planning', 'scripting', 'characters', 'producing'].includes(currentState)) return;
    const controller = new AbortController(); let reading = false, processing = false;
    const poll = async () => {
      if (reading || controller.signal.aborted) return; reading = true;
      try {
        const latest = await veloxaApi<{ production: YouTubeProduction }>(endpoint(currentId), { signal: controller.signal, redirect: 'error' });
        if (!controller.signal.aborted) apply(latest.production);
        if (!processing && !latest.production.progress?.working && active(latest.production) && (!latest.production.retryAt || latest.production.retryAt <= Date.now())) {
          processing = true;
          void veloxaApi<{ production: YouTubeProduction }>(endpoint(currentId), { method: 'POST', body: JSON.stringify({ action: 'process' }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(250_000)]), redirect: 'error' })
            .then(result => { if (!controller.signal.aborted) { apply(result.production); setError(''); } })
            .catch(() => { /* The independent status poll reconciles this same saved operation. */ })
            .finally(() => { processing = false; });
        }
      } catch { if (!controller.signal.aborted) setError('Pemeriksaan koneksi terputus. Produksi yang sama tetap tersimpan dan akan diperiksa kembali.'); }
      finally { reading = false; }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 4000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [currentId, currentState, endpoint, apply]);
  useEffect(() => {
    setViewer(''); if (!currentId || !currentState || !['character_review', 'producing', 'ready', 'attention', 'cancelled'].includes(currentState)) return;
    const controller = new AbortController();
    const refresh = () => veloxaApi(endpoint(currentId, true), { method: 'POST', signal: controller.signal, redirect: 'error' }).then(() => { if (!controller.signal.aborted) setViewer(endpoint(currentId, true)); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    void refresh(); const timer = setInterval(() => { void refresh(); }, 20 * 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [currentId, currentState, endpoint]);
  async function run(label: string, fn: () => Promise<void>) { if (busy) return; setBusy(label); setError(''); try { await fn(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Permintaan belum selesai.'); } finally { setBusy(''); } }
  function startNewVideo() {
    if (navigationLocked) return;
    focusNewVideo.current = true;
    setSelected(null); setError('');
  }
  function create() { void run('Menyimpan rencana…', async () => {
    const parsed = youtubeProductionSettings.parse(settings), body = JSON.stringify(parsed);
    if (!pending.current || pending.current.body !== body) pending.current = { id: crypto.randomUUID(), body };
    const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(), { method: 'POST', body: JSON.stringify({ id: pending.current.id, settings: parsed }), redirect: 'error' });
    apply(result.production); setSelected(result.production.id); setSettings({ ...defaults, voice: parsed.voice }); pending.current = null;
  }); }
  function action(value: 'approve_script' | 'approve_characters' | 'stop' | 'resume' | 'retry_now') { if (!current) return; void run('Menyimpan pilihan…', async () => {
    const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(current.id), { method: 'POST', body: JSON.stringify({ action: value, revision: current.revision, confirmed: true }), redirect: 'error' }); apply(result.production);
  }); }
  function character(id: string, patch: Partial<YouTubeProductionSettings['characters'][number]>) { setSettings(value => ({ ...value, characters: value.characters.map(actor => actor.id === id ? { ...actor, ...patch } : actor) })); }
  function openScriptEditor(block: YouTubeScriptBlock) {
    setRevisionNote(''); setProposal(null); setRevisionError('');
    setEditing(structuredClone(block));
  }
  function requestProposal() {
    if (!current || !editing || !revisionNote.trim()) return;
    void run('Menyusun usulan revisi…', async () => {
      setRevisionError('');
      try {
        const result = await veloxaApi<{ proposal: YouTubeScriptBlock }>(endpoint(current.id), {
          method: 'POST', redirect: 'error', body: JSON.stringify({ action: 'suggest_edit', revision: current.revision,
            index: editing.index, note: revisionNote.trim(), block: { scenes: editing.scenes } }),
        });
        setProposal(result.proposal);
      } catch (failure) {
        setRevisionError(failure instanceof Error ? failure.message : 'Usulan belum dapat dibuat. Coba kembali.');
      }
    });
  }
  function saveScript() { if (!current || !editing) return; void run('Menyimpan naskah…', async () => {
    const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(current.id), { method: 'POST', body: JSON.stringify({ action: 'edit', revision: current.revision, index: editing.index, block: { scenes: editing.scenes } }), redirect: 'error' }); apply(result.production); setEditing(null);
  }); }
  function reviseCharacter() { if (!current || !actorEdit) return; void run('Memperbarui acuan pemeran…', async () => {
    const result = await veloxaApi<{ production: YouTubeProduction }>(endpoint(current.id), { method: 'POST', redirect: 'error', body: JSON.stringify({ action: 'revise_character', revision: current.revision, characterId: actorEdit.id, appearance: actorEdit.appearance, voice: actorEdit.voice, delivery: actorEdit.delivery, confirmed: true }) });
    apply(result.production); setActorEdit(null);
  }); }
  const resources = productionResources(current?.settings ?? settings);
  const sceneCount = current?.blocks.reduce((sum, block) => sum + block.scenes.length, 0) ?? 0;
  let elapsedFrames = 0;
  const times = current?.sceneFrames?.map(frames => { const start = elapsedFrames; elapsedFrames += frames; return `${Math.floor(start / 1500)}:${(start / 25 % 60).toFixed(1).padStart(4, '0')}–${Math.floor(elapsedFrames / 1500)}:${(elapsedFrames / 25 % 60).toFixed(1).padStart(4, '0')}`; });
  const media = (name: string) => viewer + '&name=' + encodeURIComponent(name);
  const voiceSelect = (value: string, change: (voice: YouTubeProductionSettings['voice']) => void, label: string) => <VeloxaSelect aria-label={label} value={value} onValueChange={voice => change(voice as YouTubeProductionSettings['voice'])}>{youtubeVoices.map(voice => <option key={voice} value={voice}>{voice === 'achird' ? 'Achird · Indonesia' : voice}</option>)}</VeloxaSelect>;
  return <div className="min-w-0 space-y-6" data-testid="youtube-production-studio">
    <section className={panel}><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 space-y-2"><p className="text-sm font-medium text-[#a92e5d]">{props.businessName}</p><h2 className="text-xl font-semibold">Studio video AI</h2><p className="text-base text-neutral-600">Dari ide dan naskah menjadi gambar bergerak, dialog, dan video siap terbit.</p></div>{!loading && current && <div className="space-y-2 sm:max-w-64 sm:shrink-0"><button type="button" data-testid="youtube-new-video-top" disabled={navigationLocked} className={primary + ' w-full'} onClick={startNewVideo}>Buat video baru</button><p className="text-sm text-neutral-600">{navigationLocked ? 'Selesaikan proses atau simpan/batalkan perubahan terlebih dahulu.' : 'Video sebelumnya tetap ada di Produksi tersimpan.'}</p></div>}</div><ol className="grid gap-2 text-sm text-neutral-600 sm:grid-cols-4">{['Topik & durasi', 'Naskah & pemeran', 'Gambar, gerak & suara', 'Tinjau & terbitkan'].map((label, i) => <li key={label}>{i + 1}. {label}</li>)}</ol></section>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-base text-red-800">{error}</p>}
    {loading ? <p role="status" className={panel}>Memuat produksi tersimpan…</p> : !current ? <section className={panel}>
      <div className="space-y-2"><h3 ref={newVideoHeading} tabIndex={-1} className="scroll-mt-24 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-[#a92e5d]">Buat video baru</h3><p className="text-base text-neutral-600">Pilih YouTube Shorts atau video panjang, lalu isi topik untuk menyusun naskah.</p></div>
      <div role="group" aria-label="Jenis video" className="grid gap-3 sm:grid-cols-2">{(['short', 'video'] as const).map(kind => <button type="button" key={kind} aria-pressed={settings.kind === kind} onClick={() => setSettings(value => ({ ...value, kind, minutes: kind === 'short' ? 1 : 15 }))} className={`${secondary} text-start ${settings.kind === kind ? 'border-[#bd416e] bg-[#faf2f5] text-[#682943]' : ''}`}>{kind === 'short' ? 'YouTube Shorts · 9:16' : 'Video YouTube · 16:9'}</button>)}</div>
      <div className="grid gap-5 sm:grid-cols-2"><Label title="Target durasi">{settings.kind === 'short' ? <p className={field}>1 menit</p> : <><VeloxaSelect aria-label="Target durasi" value={[15, 30, 60].includes(settings.minutes) ? settings.minutes : 'custom'} onValueChange={value => setSettings(item => ({ ...item, minutes: value === 'custom' ? 90 : Number(value) }))}><option value="15">15 menit</option><option value="30">30 menit</option><option value="60">60 menit</option><option value="custom">Durasi lain</option></VeloxaSelect>{![15, 30, 60].includes(settings.minutes) && <input aria-label="Durasi dalam menit (1–120)" type="number" min={1} max={120} value={settings.minutes} onChange={event => setSettings(value => ({ ...value, minutes: Number(event.target.value) }))} className={field} />}</>}</Label><Label title="Suara narator">{voiceSelect(settings.voice, voice => setSettings(value => ({ ...value, voice })), 'Suara narator')}</Label></div>
      <Label title="Kategori cerita">
        <VeloxaSelect aria-label="Kategori cerita" value={settings.genre ?? 'auto'}
          onValueChange={value => setSettings(item => ({ ...item, genre: value as YouTubeStoryGenre }))}>
          {youtubeStoryGenres.map(genre => <option key={genre} value={genre}>{youtubeGenreLabels[genre]}</option>)}
        </VeloxaSelect>
      </Label>
      <Label title="Video ini membahas apa?"><textarea rows={4} maxLength={4000} value={settings.topic} onChange={event => setSettings(value => ({ ...value, topic: event.target.value }))} placeholder="Topik, tujuan, siapa penontonnya, dan hal penting yang perlu dibahas." className={field} /></Label>
      <Label title="Arahan visual (opsional)"><textarea rows={2} maxLength={2000} value={settings.direction} onChange={event => setSettings(value => ({ ...value, direction: event.target.value }))} placeholder="Suasana dan gaya adegan. Palet mengikuti DNA bisnis tersimpan." className={field} /></Label>
      <Label title="Pembawaan narator"><textarea rows={2} maxLength={800} value={settings.delivery} onChange={event => setSettings(value => ({ ...value, delivery: event.target.value }))} className={field} /></Label>
      <div className="space-y-4 border-t pt-5"><h3 className="text-lg font-semibold">Pemeran (opsional)</h3><p className="text-sm text-neutral-600">Satu gambar acuan dan suara tetap untuk setiap karakter. Maksimal lima pemeran.</p>{settings.characters.map((actor, index) => <fieldset key={actor.id} className="min-w-0 space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm font-semibold">Karakter {index + 1}</legend><Label title="Nama"><input className={field} maxLength={60} value={actor.name} onChange={event => character(actor.id, { name: event.target.value })} /></Label><Label title="Ciri wajah, rambut, usia dan pakaian"><textarea rows={3} className={field} value={actor.appearance} maxLength={1000} onChange={event => character(actor.id, { appearance: event.target.value })} /></Label><Label title="Suara tetap">{voiceSelect(actor.voice, voice => character(actor.id, { voice }), `Suara karakter ${index + 1}`)}</Label><Label title="Gaya bicara"><textarea rows={2} className={field} value={actor.delivery} maxLength={500} onChange={event => character(actor.id, { delivery: event.target.value })} /></Label><button type="button" className={secondary} onClick={() => setSettings(value => ({ ...value, characters: value.characters.filter(item => item.id !== actor.id) }))}>Hapus karakter {index + 1}</button></fieldset>)}<button type="button" disabled={settings.characters.length >= 5} className={secondary} onClick={() => { const id = [1, 2, 3, 4, 5].find(i => !settings.characters.some(actor => actor.id === `actor_${i}`))!; setSettings(value => ({ ...value, characters: [...value.characters, { id: `actor_${id}`, name: '', appearance: '', voice: youtubeVoices[id], delivery: '' }] })); }}>Tambah karakter</button></div>
      <p className="rounded-lg bg-[#faf2f5] p-4 text-base text-[#682943]">Target {resources.minutes} menit · jumlah gambar mengikuti isi naskah · sekitar {resources.minWords.toLocaleString('id-ID')}–{resources.maxWords.toLocaleString('id-ID')} kata. Gambar dan suara dibuat setelah naskah ditinjau.</p><p className="text-sm text-neutral-600">Suara menggunakan AI. Pilihan suara dan pembawaan belum meniru rekaman suara pribadi.</p><button type="button" className={primary} disabled={Boolean(busy) || !props.ready || !youtubeProductionSettings.safeParse(settings).success} onClick={create}>{busy || 'Susun naskah dengan AI'}</button>
    </section> : <>
      <section className={panel}><p className="text-sm font-medium text-[#a92e5d]">{productionStageLabel[current.state]}</p><h3 className="text-xl font-semibold">{current.outline?.title || current.settings.topic}</h3><p>{current.settings.minutes} menit · {current.settings.kind === 'short' ? '9:16' : '16:9'}{current.settings.genre && current.settings.genre !== 'auto' && ` · ${youtubeGenreLabels[current.settings.genre]}`}</p>
        <VeloxaYouTubeProgress production={current} />
        {viewer && <VeloxaYouTubeSceneGallery key={current.id} production={current} media={media} />}
        {current.state === 'producing' && Boolean(current.progress?.attempts) && !current.progress?.working && <button type="button" disabled={Boolean(busy)} className={secondary} onClick={() => action('retry_now')}>Coba perbaikan sekarang</button>}
        {current.settings.characters.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{current.settings.characters.map(actor => <article key={actor.id} className="min-w-0 rounded-lg border p-3">{viewer && current.portraits?.includes(actor.id) && <img src={media(actor.id + '.jpg')} alt={`Acuan tetap ${actor.name}`} className="mb-3 aspect-square w-full rounded-lg object-cover" />}<p className="font-semibold">{actor.name}</p><p className="mt-1 text-sm text-neutral-600">Suara: {actor.voice}</p>{viewer && current.portraits?.includes(actor.id) && <audio controls preload="none" aria-label={`Contoh suara ${actor.name}`} src={media(actor.id + '.wav')} className="mt-3 w-full min-w-0" />}<p className="mt-1 break-words text-sm text-neutral-600">{actor.appearance}</p>{current.state === 'character_review' && <button type="button" className={secondary + ' mt-3'} disabled={Boolean(busy) || Boolean(actorEdit)} onClick={() => setActorEdit({ ...actor })}>Perbaiki {actor.name}</button>}</article>)}</div>}
        {actorEdit && <fieldset className="min-w-0 space-y-3 rounded-lg border p-4"><legend>Perubahan belum disimpan · {actorEdit.name}</legend><Label title="Penampilan tetap"><textarea className={field} rows={3} value={actorEdit.appearance} onChange={event => setActorEdit(value => value ? { ...value, appearance: event.target.value } : value)} /></Label><Label title="Suara tetap">{voiceSelect(actorEdit.voice, voice => setActorEdit(value => value ? { ...value, voice } : value), 'Suara karakter yang diperbaiki')}</Label><Label title="Pembawaan suara"><textarea className={field} rows={2} value={actorEdit.delivery} onChange={event => setActorEdit(value => value ? { ...value, delivery: event.target.value } : value)} /></Label><div className="flex flex-wrap gap-3"><button className={primary} disabled={Boolean(busy)} onClick={reviseCharacter}>Buat ulang acuan karakter ini</button><button className={secondary} disabled={Boolean(busy)} onClick={() => setActorEdit(null)}>Batalkan perubahan</button></div></fieldset>}{current.state === 'character_review' && <><p>Tinjau wajah dan identitas semua pemeran. Acuan yang sama dipakai di setiap adegan terkait.</p><button disabled={Boolean(busy) || Boolean(actorEdit)} className={primary} onClick={() => action('approve_characters')}>Gunakan pemeran ini & produksi video</button></>}
        {current.state === 'script_review' && <><p>Produksi akan membuat {sceneCount} gambar sesuai bagian narasi, {resources.minutes} menit dialog, serta animasi kamera.</p><button disabled={Boolean(busy) || Boolean(editing)} className={primary} onClick={() => action('approve_script')}>{current.settings.characters.length ? 'Naskah sesuai · buat acuan pemeran' : 'Naskah sesuai · produksi video'}</button></>}
        {current.state === 'attention' && <button disabled={Boolean(busy)} className={primary} onClick={() => action('resume')}>Lanjutkan produksi yang sama</button>}
        {!['ready', 'cancelled'].includes(current.state) && <button disabled={Boolean(busy) || Boolean(editing)} className={secondary} onClick={() => action('stop')}>Hentikan produksi</button>}
      </section>
      {current.blocks.length > 0 && <section className={panel}><h3 className="text-lg font-semibold">Naskah & urutan adegan</h3>{current.blocks.map(block => <details key={block.index} className="min-w-0 border-t pt-4"><summary className="min-h-11 cursor-pointer font-medium">Menit {block.index + 1} · {block.chapter}</summary><div className="space-y-4 py-3">{block.scenes.map((scene, index) => <div key={index} className="space-y-2"><h4 className="font-semibold">{index + 1}. {scene.title}</h4>{times?.[current.blocks.slice(0, current.blocks.indexOf(block)).reduce((sum, value) => sum + value.scenes.length, 0) + index] && <p className="text-sm tabular-nums text-[#a92e5d]">{times[current.blocks.slice(0, current.blocks.indexOf(block)).reduce((sum, value) => sum + value.scenes.length, 0) + index]} · mengikuti audio adegan</p>}<p className="text-sm text-neutral-600">{scene.supporting}</p>{scene.lines.map((line, i) => <p key={i}><span className="font-medium">{line.speakerId === 'narrator' ? 'Narator' : current.settings.characters.find(actor => actor.id === line.speakerId)?.name}: </span>{line.text}</p>)}<p className="text-sm text-neutral-500">Visual: {scene.visual}</p></div>)}{current.state === 'script_review' && <button disabled={Boolean(editing) || Boolean(busy)} className={secondary} onClick={() => openScriptEditor(block)}>Edit menit {block.index + 1}</button>}</div></details>)}</section>}
      {editing && <section className={panel}><h3 className="text-lg font-semibold">Perubahan belum disimpan · menit {editing.index + 1}</h3>
        <Label title="Catatan revisi untuk AI"><textarea autoFocus className={field} rows={3} maxLength={2000}
          disabled={Boolean(busy)} value={revisionNote} placeholder="Misalnya, buka langsung dengan peristiwa utama dan pendekkan kalimat pertama."
          onChange={event => { setRevisionNote(event.target.value); setProposal(null); setRevisionError(''); }} /></Label>
        <button type="button" className={secondary} disabled={Boolean(busy) || Boolean(proposal) || !revisionNote.trim()} onClick={requestProposal}>
          {busy === 'Menyusun usulan revisi…' ? busy : 'Usulkan revisi dengan AI'}
        </button>
        {revisionError && <p role="alert" className="text-red-800">{revisionError}</p>}
        {proposal && <div className="space-y-4 rounded-lg border border-[#dab6c5] bg-[#faf2f5] p-4">
          <h4 className="font-semibold" role="status">Usulan AI · belum disimpan</h4>
          {proposal.scenes.map((scene, i) => <div key={i} className="space-y-1">
            <p className="font-medium">{scene.title}</p>
            <p className="text-sm text-neutral-600">{scene.supporting}</p>
            {scene.lines.map((line, j) => <p key={j}>{current.settings.characters.find(actor => actor.id === line.speakerId)?.name ?? 'Narator'}: {line.text}</p>)}
            <p className="text-sm text-neutral-600">Visual: {scene.visual}</p>
          </div>)}
          <div className="flex flex-wrap gap-3">
            <button className={primary} type="button" onClick={() => { setEditing(proposal); setProposal(null); }}>Gunakan usulan</button>
            <button className={secondary} type="button" onClick={() => setProposal(null)}>Abaikan usulan</button>
          </div>
        </div>}
        {editing.scenes.map((scene, index) => <fieldset key={index} disabled={Boolean(busy) || Boolean(proposal)} className="min-w-0 space-y-3 border-t pt-4"><legend>Adegan {index + 1}</legend>{(['title', 'supporting', 'visual'] as const).map(key => <Label key={key} title={{ title: 'Judul', supporting: 'Teks pendukung', visual: 'Arahan foto' }[key]}><textarea className={field} rows={2} value={scene[key]} onChange={event => setEditing(value => value ? { ...value, scenes: value.scenes.map((s, i) => i === index ? { ...s, [key]: event.target.value } : s) } : null)} /></Label>)}{scene.lines.map((line, lineIndex) => <Label key={lineIndex} title={`Dialog ${lineIndex + 1} · ${line.speakerId === 'narrator' ? 'Narator' : current.settings.characters.find(actor => actor.id === line.speakerId)?.name}`}><textarea className={field} rows={3} value={line.text} onChange={event => setEditing(value => value ? { ...value, scenes: value.scenes.map((s, i) => { if (i !== index) return s; const lines = s.lines.map((l, j) => j === lineIndex ? { ...l, text: event.target.value } : l); return { ...s, lines, narration: lines.map(l => l.text).join(' ') }; }) } : null)} /></Label>)}</fieldset>)}<button type="button" className={secondary} disabled={Boolean(busy) || Boolean(proposal)} onClick={() => setEditing(value => value ? segmentYouTubeNarration(value) : value)}>Pisahkan gambar mengikuti kalimat narasi</button><p className="text-sm text-neutral-600">Setiap kalimat utuh mendapat gambar yang sesuai. Kata-kata dan suara pemeran tetap mengikuti naskah. Pertahankan 105–125 kata narasi per menit untuk pembawaan alami.</p><div className="flex flex-wrap gap-3"><button disabled={Boolean(busy) || Boolean(proposal)} className={primary} onClick={saveScript}>Simpan naskah</button><button disabled={Boolean(busy)} className={secondary} onClick={() => setEditing(null)}>Batalkan perubahan</button></div></section>}
      {current.state === 'ready' && <><section id="youtube-final-preview" className={panel}><h3 className="text-lg font-semibold">Tinjau video akhir</h3>{viewer ? <><video src={media('final.mp4')} controls playsInline preload="metadata" className={`mx-auto w-full rounded-lg bg-neutral-950 ${current.settings.kind === 'short' ? 'max-w-sm' : ''}`} /><p className="text-sm text-neutral-600">Durasi render: {current.durationSeconds?.toLocaleString('id-ID')} detik · suara AI</p><a className={secondary} href={media('final.mp4') + '&download=1'}>Unduh MP4</a></> : <p role="status">Menyiapkan pratinjau privat…</p>}<div className="space-y-2 border-t pt-4"><button type="button" data-testid="youtube-new-video-preview" disabled={navigationLocked} className={secondary} onClick={startNewVideo}>Buat video baru</button><p className="text-sm text-neutral-600">Pilih Shorts atau video panjang berikutnya. Hasil ini tetap tersimpan.</p></div></section><VeloxaYouTubePublish {...props} production={current} onDirtyChange={setPublishDirty} /></>}
    </>}
    {productions.length > 0 && <section className={panel}><h3 className="text-lg font-semibold">Produksi tersimpan</h3>{productions.map(item => <button type="button" key={item.id} disabled={Boolean(editing) || Boolean(actorEdit) || Boolean(busy) || publishDirty} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setError(''); }} className={`${secondary} flex w-full min-w-0 flex-col items-start text-start`}><span className="break-words font-semibold">{item.outline?.title || item.settings.topic}</span><span className="mt-1 text-sm text-neutral-600">{productionStageLabel[item.state]} · {item.settings.minutes} menit</span></button>)}</section>}
  </div>;
}
