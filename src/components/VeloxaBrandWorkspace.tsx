'use client';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';
import styles from './VeloxaWorkspace.module.css';
import {AssetKindPicker} from './AssetKindPicker';
import {BrandAssetCategory} from './BrandAssetCategory';
import {parseAssetKind,type AssetKind,type AssetKindMetadata,type AssetKindSuggestion} from '@/lib/asset-kind';
import {paletteFingerprint,canAutoFillFirstLogo,logoPalettePatch} from '@/lib/logo-palette-proposal';
import {BrandProfileAssistant} from './BrandProfileAssistant';
import {analyzeVeloxaBrand} from '@/lib/veloxa-api-client';
import {applyBrandSuggestions,type BrandAnalysis,type AnalysisStage,type SuggestionKey} from '@/lib/brand-analysis';
import {profileFingerprint} from '@/lib/profile-fingerprint';
import { BusinessCategoryPicker } from './BusinessCategoryPicker';
import { VeloxaBrandVisualDna } from './VeloxaBrandVisualDna';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { AuthenticatedBrandPhoto } from '@/components/AuthenticatedBrandPhoto';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Building2, Check, ImagePlus, Images, Loader2, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { normalizeBrandProfile } from '@/lib/veloxa-brand-profile';
import type { BrandProfile, BrandVaultAsset, ChannelConnectionState } from '@/lib/veloxa-types';
interface Props {
  brand: BrandProfile; assets: BrandVaultAsset[]; accounts?:ChannelConnectionState[];accountsReady?:boolean;
  onSave: (brand: BrandProfile) => Promise<void>;
  onUpload: (file: File, title: string,kind?:AssetKindMetadata) => Promise<BrandVaultAsset>;
  onMetadata:(asset:BrandVaultAsset,kind:AssetKindMetadata)=>Promise<BrandVaultAsset>;
  onAssetState: (assetId: string, action: 'trash' | 'restore') => Promise<void>;
  onReload: () => Promise<void>;
  onFirstDraft?: () => void;
  onDirtyChange?:(dirty:boolean)=>void;
  onBusyChange?:(busy:boolean)=>void;
}
const tabs = [{id:'identity',label:'Identitas bisnis',icon:Building2},{id:'content',label:'Panduan konten',icon:SlidersHorizontal},{id:'dna',label:'DNA visual',icon:SlidersHorizontal},{id:'photos',label:'Foto & referensi',icon:Images}] as const;
const inputClass = 'mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-3 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-[#ad6685] focus:outline-none focus:ring-2 focus:ring-[#bd416e]/10 disabled:bg-neutral-50';
function initialProfile(brand: BrandProfile): BrandProfile { return { ...brand, businessDescription: brand.businessDescription || (brand.offerings[0]?.title.length > 120 ? brand.offerings[0].title : '') }; }
export function VeloxaBrandWorkspace(props: Props) {
 const {t,locale}=useWorkspaceCopy(workspaceCatalog);

  const profileJson=JSON.stringify(props.brand);
  const initial = useMemo(() => initialProfile(JSON.parse(profileJson) as BrandProfile), [profileJson]);
  const [form, setForm] = useState(initial); const [tab,setTab] = useState<typeof tabs[number]['id']>('identity');
  const [uploadKind,setUploadKind]=useState<AssetKind|'auto'>('auto');const[customKind,setCustomKind]=useState('');const[suggestions,setSuggestions]=useState<Record<string,AssetKindSuggestion>>({});
  const[paletteProposal,setPaletteProposal]=useState<{assetId:string;title:string;patch:Partial<BrandProfile>;base:string}|null>(null);
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);const formRef=useRef(initial);formRef.current=form;
  const [trash,setTrash] = useState(false); const [title,setTitle] = useState('');
  const [busy,setBusy] = useState<string|null>(null); const operation = useRef(false);
  const [feedback,setFeedback] = useState<{kind:'success'|'error';message:string}|null>(null);
  const [libraryLoading,setLibraryLoading] = useState(true); const [libraryError,setLibraryError] = useState('');
  const initialReload = useRef(props.onReload); const fileInput = useRef<HTMLInputElement>(null);
  const [preview,setPreview]=useState<BrandVaultAsset|null>(null);const previewDialog=useRef<HTMLDialogElement>(null);
  useEffect(() => setForm(initial),[initial]);
  useEffect(()=>{props.onDirtyChange?.(JSON.stringify(form)!==JSON.stringify(initial));},[form,initial,props.onDirtyChange]);
  useEffect(()=>{props.onBusyChange?.(Boolean(busy)||libraryLoading);return()=>props.onBusyChange?.(false);},[busy,libraryLoading,props.onBusyChange]);
  useEffect(() => { let active=true; void initialReload.current().catch(() => { if(active)setLibraryError('Foto belum dapat dimuat. Coba muat ulang sebelum mengubah galeri.'); }).finally(() => { if(active)setLibraryLoading(false); }); return () => {active=false;}; },[]);
  const dirty = JSON.stringify(form)!==JSON.stringify(initial);
  const profileFormId = useId();
  const activePhotos = props.assets.filter(asset=>!asset.trashedAt); const trashedPhotos=props.assets.filter(asset=>asset.trashedAt);
  const photos=trash?trashedPhotos:activePhotos;
  const set = <K extends keyof BrandProfile>(key:K,value:BrandProfile[K]) => { setForm(previous=>({...previous,[key]:value})); setFeedback(null); };
  function discardProfileChanges() {
    setForm(initial);
    setFeedback(null);
  }
  async function saveProfile() {
    const submitted = form;
    await props.onSave(normalizeBrandProfile(submitted));
    // If normalization produced the already saved profile, props may not change.
    setForm(current => current === submitted ? initial : current);
  }
  async function run(key:string,action:()=>Promise<void>,message:string) {
    if(operation.current)return; operation.current=true;setBusy(key);setFeedback(null);
    try { await action();setFeedback({kind:'success',message}); } catch(error) { setFeedback({kind:'error',message:error instanceof Error?error.message:'Perubahan belum berhasil. Silakan coba lagi.'}); }
    finally {operation.current=false;setBusy(null);}
  }
  async function analyzeProfile(ids:string[],progress:(stage:AnalysisStage)=>void) {
    if(operation.current||dirty||!props.accountsReady)throw new Error('Simpan perubahan atau tunggu akun selesai dimuat.');
    operation.current=true;setBusy('analysis');setFeedback(null);
    try{return await analyzeVeloxaBrand({workspaceId:props.brand.workspaceId,businessId:props.brand.businessId||'primary',profileFingerprint:await profileFingerprint(props.brand),connectionIds:ids},progress);}
    finally{operation.current=false;setBusy(null);}
  }
  async function applyAnalysis(result:BrandAnalysis,keys:SuggestionKey[],offeringIds:string[]) {
    if(operation.current||dirty)throw new Error('Simpan atau batalkan perubahan formulir terlebih dahulu.');
    if(result.baseFingerprint!==await profileFingerprint(props.brand))throw new Error('Profil berubah. Analisis ulang sebelum memakai usulan.');
    setForm(applyBrandSuggestions(initial,result,keys,offeringIds));setTab('identity');setFeedback(null);
  }
  async function proposeLogo(asset:Pick<BrandVaultAsset,'id'|'title'>) {
    const base=paletteFingerprint(formRef.current);const result=await veloxaApi<{colors:string[]}>('/api/veloxa/brand/palette',{method:'POST',body:JSON.stringify({workspaceId:formRef.current.workspaceId,businessId:formRef.current.businessId||'primary',assetId:asset.id})});
    if(!alive.current)return;if(base!==paletteFingerprint(formRef.current))throw new Error('Palet berubah saat warna diambil. Pilih logo kembali agar perubahan Anda tetap terjaga.');
    const patch=logoPalettePatch(asset.id,result.colors);if(canAutoFillFirstLogo(initial,formRef.current)){setForm(previous=>({...previous,...patch}));setPaletteProposal(null);}else setPaletteProposal({assetId:asset.id,title:asset.title,patch,base});setTab('dna');
  }
  function analyzeLogo(assetId:string){const asset=activePhotos.find(item=>item.id===assetId);if(asset)void run('palette',()=>proposeLogo(asset),'Saran warna siap ditinjau. Perubahan DNA baru berlaku setelah Simpan profil.');}
  function applyPalette(){if(!paletteProposal)return;if(paletteProposal.base!==paletteFingerprint(formRef.current)||!activePhotos.some(asset=>asset.id===paletteProposal.assetId)){setPaletteProposal(null);setFeedback({kind:'error',message:'Palet atau foto berubah. Ambil saran logo kembali.'});return;}setForm(previous=>({...previous,...paletteProposal.patch}));setPaletteProposal(null);setFeedback({kind:'success',message:'Palet masuk ke formulir. Tinjau lalu Simpan profil untuk menerapkannya.'});}
  async function assetOperation<T>(key:string,action:()=>Promise<T>):Promise<T>{if(operation.current)throw new Error('Tunggu proses yang sedang berjalan.');operation.current=true;setBusy(key);setFeedback(null);try{return await action();}finally{operation.current=false;if(alive.current)setBusy(null);}}
  async function recognizeAsset(asset:BrandVaultAsset){const result=await veloxaApi<{suggestion:AssetKindSuggestion}>('/api/veloxa/media/analyze',{method:'POST',body:JSON.stringify({workspaceId:formRef.current.workspaceId,businessId:formRef.current.businessId||'primary',assetId:asset.id,expectedRevision:asset.metadataRevision||0})});return result.suggestion;}
  async function reload() { setLibraryLoading(true);setLibraryError('');try{await props.onReload();}catch{setLibraryError('Foto belum dapat dimuat. Periksa koneksi lalu coba lagi.');}finally{setLibraryLoading(false);} }
  async function pick(file?:File) {
    if(!file||operation.current)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>8*1024*1024){setFeedback({kind:'error',message:'Pilih foto JPG, PNG, atau WebP maksimal 8 MB.'});return;}
    let kind:AssetKindMetadata|undefined;try{if(uploadKind!=='auto')kind=parseAssetKind({category:uploadKind,customCategoryLabel:customKind});}catch(error){setFeedback({kind:'error',message:(error as Error).message});return;}
    operation.current=true;setBusy('upload');setFeedback(null);let uploaded=false;
    try{const asset=await props.onUpload(file,title.trim(),kind);uploaded=true;if(!alive.current)return;setTitle('');setFeedback({kind:'success',message:'Foto tersimpan dan dapat dipilih sebagai referensi di Studio.'});
      if(uploadKind==='auto'){setBusy('recognize');try{const suggestion=await recognizeAsset(asset);if(alive.current){setSuggestions(previous=>({...previous,[asset.id]:suggestion}));setFeedback({kind:'success',message:'Foto tersimpan. Tinjau usulan jenis dari AI pada kartu foto, lalu konfirmasi atau koreksi.'});}}catch(error){if(alive.current)setFeedback({kind:'error',message:'Foto tetap tersimpan. '+(error instanceof Error?error.message:'Pilih jenis secara manual.')});}}
      else if(kind?.category==='logo'){setBusy('palette');await proposeLogo(asset);if(alive.current)setFeedback({kind:'success',message:'Logo tersimpan. Tinjau DNA visual, lalu Simpan profil untuk menerapkan palet.'});}
    }catch(error){if(alive.current)setFeedback({kind:'error',message:(uploaded?'Foto tetap tersimpan. ':'')+(error instanceof Error?error.message:'Proses belum selesai.')});}
    finally{operation.current=false;if(alive.current)setBusy(null);}
  }
  return <div className="space-y-6">
    <section className={`veloxa-panel ${styles.sectionIntro} p-4 sm:p-6`}>
      <div className="flex items-start gap-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--ws-action)] text-base font-semibold text-white">{props.brand.businessName.slice(0,1).toUpperCase()}</div><div className="min-w-0"><p className="text-sm font-medium text-[var(--ws-action,#682943)]">{t("Dasar konten Anda")}</p><h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{t("Kenalkan bisnis Anda.")}</h2><p className="mt-2 max-w-2xl text-base leading-relaxed text-neutral-500">{t("Profil, produk, dan aset menjadi acuan saat AI membuat konten.")}</p></div></div>
    </section>
    <div role="tablist" aria-label={t("Bagian profil dan aset")} className="grid grid-cols-2 gap-1 sm:grid-cols-4 rounded-xl border border-neutral-200 bg-white p-1.5">{tabs.map(item=><button key={item.id} type="button" role="tab" id={`brand-tab-${item.id}`} aria-selected={tab===item.id} aria-controls={`brand-panel-${item.id}`} disabled={!!busy} onClick={()=>{setTab(item.id);setFeedback(null);}} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-start text-sm font-medium sm:justify-center ${tab===item.id?'bg-[#faf0f4] text-[var(--ws-action,#682943)]':'text-neutral-500 hover:bg-neutral-50'}`}><item.icon size={19}/>{t(item.label)}</button>)}</div>
    <div hidden={tab!=='identity'}><BrandProfileAssistant brand={props.brand} accounts={props.accounts||[]} ready={!!props.accountsReady} disabled={!!busy} dirty={dirty} profileFormId={profileFormId} saving={busy==='save'} onDiscard={discardProfileChanges} onAnalyze={analyzeProfile} onApply={applyAnalysis}/></div>
    {busy==='recognize'&&<p role="status" className="flex items-center gap-2 text-base text-neutral-500"><Loader2 size={18} className="animate-spin"/>{t("Mengenali jenis foto dengan AI… Foto yang sudah diunggah tetap tersimpan.")}</p>}
    {busy==='palette'&&<p role="status" className="flex items-center gap-2 text-base text-neutral-500"><Loader2 size={18} className="animate-spin"/>{t("Mengambil warna logo…")}</p>}
    {feedback&&<div role={feedback.kind==='error'?'alert':'status'} className={`flex items-start gap-2 rounded-lg border p-4 text-base ${feedback.kind==='error'?'border-red-200 bg-red-50 text-red-900':'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{feedback.kind==='success'&&<Check size={19} className="mt-0.5 shrink-0"/>}{t(feedback.message)}</div>}
    {tab!=='photos'?<div role="tabpanel" id={`brand-panel-${tab}`} aria-labelledby={`brand-tab-${tab}`}><form id={profileFormId} onSubmit={event=>{event.preventDefault();if(dirty)void run('save',saveProfile,'Profil tersimpan. Konten berikutnya akan memakai informasi ini.');}} className="veloxa-panel">
      <fieldset disabled={!!busy} className="p-5 sm:p-7"><legend className="sr-only">{tab==='identity'?t("Identitas bisnis"):tab==='dna'?t("DNA visual"):t("Panduan konten")}</legend>
      {tab==='dna'?<>{paletteProposal&&<section aria-label={t("Saran palet logo")} className="mb-5 space-y-4 rounded-lg border border-[#e8c3d0] bg-[#fcf5f8] p-4"><h4 className="text-lg font-semibold">{t("Gunakan palet dari logo ini?")}</h4><p className="text-sm text-neutral-600">{paletteProposal.title} {t("· Palet Anda tetap dipertahankan sampai memilih Gunakan palet.")}</p><div className="flex flex-wrap gap-3">{[paletteProposal.patch.primaryColorHex,paletteProposal.patch.accentColorHex,...(paletteProposal.patch.additionalColorHexes||[])].map((color,index)=><div key={index} className="rounded-lg border bg-white p-2"><span className="mb-1 block h-10 w-20 rounded-md" style={{backgroundColor:color}}/><span className="font-mono text-sm">{color}</span></div>)}</div><div className="flex flex-wrap gap-2"><button type="button" disabled={!!busy} onClick={applyPalette} className="veloxa-button-primary">{t("Gunakan palet")}</button><button type="button" disabled={!!busy} onClick={()=>{setPaletteProposal(null);setFeedback(null);}} className="veloxa-button-secondary">{t("Batal")}</button></div></section>}<VeloxaBrandVisualDna brand={form} assets={props.assets} busy={!!busy} libraryReady={!libraryLoading&&!libraryError} onChange={patch=>{setPaletteProposal(null);setForm(previous=>({...previous,...patch}));setFeedback(null);}} onAnalyze={analyzeLogo} onOpenPhotos={()=>setTab('photos')}/></>:tab==='identity'?<div className="space-y-5"><div><h3 className="text-xl font-semibold">{t("Apa yang perlu diketahui tentang bisnis Anda?")}</h3><p className="mt-1 text-sm text-neutral-500">{t("Gunakan informasi yang benar. Anda dapat memperbaruinya kapan saja.")}</p></div>
        <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-medium" htmlFor="brand-business-name">{t("Nama bisnis")} <span className="text-[var(--ws-action,#682943)]">*</span><input id="brand-business-name" required maxLength={110} value={form.businessName} onChange={e=>set('businessName',e.target.value)} className={inputClass}/></label><BusinessCategoryPicker locale={locale} value={form.category} onChange={value=>set('category',value)}/></div>
        <label className="block text-sm font-medium" htmlFor="brand-description">{t("Tentang bisnis")}<textarea id="brand-description" rows={4} maxLength={2000} value={form.businessDescription||''} onChange={e=>set('businessDescription',e.target.value)} placeholder={t("Apa yang Anda tawarkan, untuk siapa, dan apa keunggulannya?")} className={inputClass+' resize-y leading-relaxed'}/><span className="mt-2 block text-sm font-normal text-neutral-500">{t("Penjelasan ini membantu AI memahami konteks bisnis Anda.")}</span></label>
        <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-medium" htmlFor="brand-city">{t("Area layanan")} <span className="font-normal text-neutral-400">{t("(opsional)")}</span><textarea id="brand-city" rows={2} maxLength={250} value={form.city} onChange={e=>set('city',e.target.value)} placeholder={t("Bandung, Jakarta, dan Surabaya; atau Seluruh Indonesia (online)")} className={inputClass}/><span className="mt-2 block text-sm font-normal leading-relaxed text-neutral-500">{t("Wilayah pelanggan yang Anda layani, bukan alamat kantor. Bisa beberapa kota atau seluruh Indonesia. Kosongkan bila wilayah tidak perlu disebut dalam konten.")}</span></label><label className="block text-sm font-medium" htmlFor="brand-website">{t("Website")} <span className="font-normal text-neutral-400">{t("(opsional)")}</span><input id="brand-website" value={form.websiteUrl} onChange={e=>set('websiteUrl',e.target.value)} placeholder="https://bisnisanda.com" className={inputClass}/></label></div>
        <section aria-labelledby="brand-offerings-heading" className="rounded-lg border border-neutral-200"><h4 id="brand-offerings-heading" className="p-4 text-lg font-semibold">{t("Produk & layanan")} <span className="ml-1 text-sm font-normal text-neutral-500">{form.offerings.length} item</span></h4><div className="space-y-4 border-t border-neutral-100 p-4"><p className="text-sm text-neutral-500">{t("Tambahkan satu produk, modul, atau layanan per item. AI memakai nama dan penjelasannya untuk membuat konten yang relevan. Harga boleh dikosongkan.")}</p>{form.offerings.map((offering,index)=><div key={offering.id} className="space-y-3 rounded-lg bg-neutral-50 p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium">{t("Produk / layanan")} {index+1}</p><button type="button" disabled={!!busy} aria-label={`Hapus produk ${index+1}`} onClick={()=>set('offerings',form.offerings.filter((_,i)=>i!==index))} className="rounded p-2 text-neutral-500 hover:bg-white"><X size={17}/></button></div><label htmlFor={`offering-${index}`} className="block text-sm font-medium">{t("Nama produk atau layanan")}<textarea id={`offering-${index}`} rows={2} value={offering.title} onChange={e=>set('offerings',form.offerings.map((item,i)=>i===index?{...item,title:e.target.value}:item))} className={inputClass}/></label><label htmlFor={`offering-price-${index}`} className="block text-sm font-medium">{t("Info harga")} <span className="font-normal text-neutral-400">{t("(opsional)")}</span><input id={`offering-price-${index}`} placeholder={t("Kosongkan jika harga tidak perlu disebut")} value={offering.priceLabel} onChange={e=>set('offerings',form.offerings.map((item,i)=>i===index?{...item,priceLabel:e.target.value}:item))} className={inputClass}/></label><label htmlFor={`offering-highlight-${index}`} className="block text-sm font-medium">{t("Penjelasan & manfaat")}<textarea id={`offering-highlight-${index}`} rows={3} placeholder={t("Apa fungsinya, untuk siapa, dan manfaat apa yang boleh disebut?")} value={offering.highlight} onChange={e=>set('offerings',form.offerings.map((item,i)=>i===index?{...item,highlight:e.target.value}:item))} className={inputClass}/></label></div>)}<button type="button" disabled={!!busy} onClick={()=>set('offerings',[...form.offerings,{id:`off_${crypto.randomUUID()}`,title:'',category:'service',priceLabel:'',highlight:''}])} className="veloxa-button-secondary"><Plus size={17}/>{t("Tambah produk atau layanan")}</button></div></section>
      </div>:<div className="space-y-5"><div><h3 className="text-xl font-semibold">{t("Konten seperti apa yang mewakili bisnis Anda?")}</h3><p className="mt-1 text-sm text-neutral-500">{t("Panduan ini dipakai untuk menyusun naskah dan caption.")}</p></div>
        <label htmlFor="brand-audience" className="block text-sm font-medium">{t("Siapa yang ingin Anda jangkau?")}<textarea id="brand-audience" rows={3} maxLength={500} value={form.targetAudience} onChange={e=>set('targetAudience',e.target.value)} placeholder={t("Misalnya: pemilik usaha yang ingin mencatat stok dan penjualan dengan rapi")} className={inputClass}/></label>
        <label htmlFor="brand-tone" className="block text-sm font-medium">{t("Gaya bahasa")}<textarea id="brand-tone" rows={2} maxLength={250} value={form.brandTone} onChange={e=>set('brandTone',e.target.value)} placeholder={t("Misalnya: ramah, jelas, dan profesional")} className={inputClass}/></label>
        <label htmlFor="brand-cta" className="block text-sm font-medium">{t("Apa yang sebaiknya dilakukan pembaca?")}<textarea id="brand-cta" rows={2} maxLength={300} value={form.defaultCta} onChange={e=>set('defaultCta',e.target.value)} placeholder={t("Misalnya: simpan tips ini atau kunjungi website kami")} className={inputClass}/></label>
        <label htmlFor="brand-forbidden" className="block text-sm font-medium">{t("Kata yang perlu dihindari")} <span className="font-normal text-neutral-400">{t("(opsional)")}</span><textarea id="brand-forbidden" rows={2} value={form.forbiddenWords.join('\n')} onChange={e=>set('forbiddenWords',e.target.value.split('\n'))} placeholder={t("Satu kata atau frasa per baris")} className={inputClass}/></label>
      </div>}</fieldset>
      <div className="flex flex-col gap-4 border-t border-neutral-100 bg-neutral-50/50 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <p className="text-sm text-neutral-500">{dirty?t("Ada perubahan yang belum disimpan."):t("Profil tersimpan. Ubah isian untuk memperbaruinya.")}</p>
        <div className="flex flex-wrap gap-2">
          {dirty && <button type="button" disabled={!!busy} onClick={discardProfileChanges} className="veloxa-button-secondary">{t("Batalkan perubahan")}</button>}
          {!dirty && !busy && initial.businessDescription?.trim() && props.onFirstDraft ? (
            <button type="button" onClick={props.onFirstDraft} className="veloxa-button-primary">{t("Buat draf pertama")}</button>
          ) : (
            <button type="submit" disabled={!!busy||!dirty} className="veloxa-button-primary">
              {busy==='save'?<Loader2 size={17} className="animate-spin"/>:<Save size={17}/>} {busy==='save'?t("Menyimpan…"):t("Simpan profil")}
            </button>
          )}
        </div>
      </div>
    </form></div>:<section role="tabpanel" id="brand-panel-photos" aria-labelledby="brand-tab-photos" className="space-y-5">
      <div className="veloxa-panel p-5 sm:p-7"><div className="flex items-start gap-3"><ImagePlus size={24} className="mt-1 shrink-0 text-[var(--ws-action,#682943)]"/><div><h3 className="text-xl font-semibold">{t("Unggah foto untuk referensi konten.")}</h3><p className="mt-2 text-sm leading-relaxed text-neutral-500">{t("Tambahkan foto orang, produk, tampilan aplikasi, lokasi, atau contoh gaya visual. Setelah diunggah, buka Content Studio dan centang hingga 6 foto referensi untuk dipadukan oleh AI. Pilih jenis Logo untuk mendapat saran warna DNA. Simpan profil setelah meninjaunya.")}</p></div></div><div className="mt-5"><AssetKindPicker value={uploadKind} customLabel={customKind} onChange={setUploadKind} onCustom={setCustomKind} disabled={!!busy} allowAuto/><p className="mt-3 text-sm leading-relaxed text-neutral-500">{t("AI hanya memberi usulan jenis dari gambar. Anda dapat mengonfirmasi atau mengoreksinya. Nama foto tetap bebas.")}</p></div><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><label htmlFor="brand-photo-title" className="block min-w-0 flex-1 text-sm font-medium">{t("Nama foto")} <span className="font-normal text-neutral-400">{t("(opsional)")}</span><input id="brand-photo-title" value={title} maxLength={160} disabled={!!busy} onChange={e=>setTitle(e.target.value)} placeholder={t("Misalnya: Foto produk utama")} className={inputClass}/></label><button type="button" disabled={!!busy||libraryLoading||!!libraryError} onClick={()=>fileInput.current?.click()} className="veloxa-button-primary shrink-0">{busy==='upload'?<Loader2 size={17} className="animate-spin"/>:<Plus size={17}/>} {busy==='upload'?t("Mengunggah…"):t("Unggah foto referensi")}</button><input ref={fileInput} data-testid="brand-photo-file" type="file" aria-label={t("Pilih foto brand")} accept="image/jpeg,image/png,image/webp" disabled={!!busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void pick(file);}} className="sr-only"/></div><p className="mt-3 text-sm text-neutral-500">{t("JPG, PNG, atau WebP · maksimal 8 MB per foto")}</p></div>
      <div className="veloxa-panel p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div role="group" aria-label={t("Filter foto brand")} className="flex rounded-lg bg-neutral-100 p-1"><button type="button" aria-pressed={!trash} onClick={()=>setTrash(false)} className={`rounded-md px-3 py-2 text-sm font-medium ${!trash?'bg-white shadow-sm':'text-neutral-500'}`}>{t("Foto aktif (")}{activePhotos.length})</button><button type="button" aria-pressed={trash} onClick={()=>setTrash(true)} className={`rounded-md px-3 py-2 text-sm font-medium ${trash?'bg-white shadow-sm':'text-neutral-500'}`}>{t("Sampah (")}{trashedPhotos.length})</button></div><button type="button" disabled={libraryLoading||!!busy} onClick={()=>void reload()} className="text-sm font-medium text-neutral-500 hover:text-neutral-900">{t("Muat ulang")}</button></div>
      {libraryLoading?<p role="status" className="mt-8 flex items-center gap-2 text-base text-neutral-500"><Loader2 size={18} className="animate-spin"/>{t("Memuat foto…")}</p>:libraryError?<p role="alert" className="mt-5 text-base text-red-700">{t(libraryError)}</p>:photos.length===0?<div className="py-12 text-center"><Images size={32} className="mx-auto text-neutral-300"/><h4 className="mt-4 text-lg font-semibold">{trash?t("Sampah kosong"):t("Belum ada foto brand")}</h4><p className="mt-2 text-sm text-neutral-500">{trash?t("Foto yang dihapus dapat dipulihkan di sini."):t("Mulai dengan satu foto produk, logo, atau kegiatan bisnis Anda.")}</p></div>:<div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{photos.map(asset=><article key={asset.id} className="overflow-hidden rounded-lg border border-neutral-200"><button type="button" onClick={()=>{setPreview(asset);previewDialog.current?.showModal();}} aria-label={`Lihat foto ${asset.title}`} className="block aspect-[4/3] w-full bg-neutral-50"><AuthenticatedBrandPhoto asset={asset} alt={asset.title} className="h-full w-full"/></button><div className="p-4"><h4 className="break-words text-base font-medium">{asset.title}</h4><p className="mt-1 text-sm text-neutral-500">{asset.drawer==='style_reference'?t("Referensi tersimpan"):t("Foto brand")}</p>{!trash&&<BrandAssetCategory asset={asset} disabled={!!busy||libraryLoading||!!libraryError} suggestion={suggestions[asset.id]} onRecognize={item=>assetOperation('recognize',()=>recognizeAsset(item))} onMetadata={(item,kind)=>assetOperation('metadata',()=>props.onMetadata(item,kind))} onLogo={item=>analyzeLogo(item.id)}/>}<button type="button" disabled={!!busy||libraryLoading||!!libraryError} aria-label={`${trash?'Pulihkan':'Hapus'} ${asset.title}`} onClick={()=>void run(asset.id,()=>props.onAssetState(asset.id,trash?'restore':'trash'),trash?'Foto dipulihkan dan dapat dipilih kembali di Studio.':'Foto dipindahkan ke Sampah. Anda dapat memulihkannya kapan saja.')} className={`mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${trash?'bg-neutral-100 text-neutral-800':'text-red-700 hover:bg-red-50'}`}>{busy===asset.id?<Loader2 size={16} className="animate-spin"/>:trash?<RotateCcw size={16}/>:<Trash2 size={16}/>} {trash?t("Pulihkan"):t("Hapus")}</button></div></article>)}</div>}
      <p className="mt-5 border-t border-neutral-100 pt-4 text-sm leading-relaxed text-neutral-500">{t("Menghapus foto memindahkannya ke Sampah. Visual pada draf dan postingan yang sudah dibuat tetap tersedia.")}</p></div>
    </section>}
    <dialog ref={previewDialog} aria-label={t("Pratinjau foto brand")} className="w-[min(900px,94vw)] rounded-xl p-5 backdrop:bg-black/40"><div className="mb-4 flex items-start justify-between gap-4"><h3 className="break-words text-lg font-semibold">{preview?.title}</h3><button type="button" aria-label={t("Tutup pratinjau foto")} onClick={()=>previewDialog.current?.close()} className="veloxa-button-secondary"><X size={18}/></button></div>{preview&&<AuthenticatedBrandPhoto asset={preview} alt={preview.title} className="h-[65vh] w-full"/>}</dialog>
    {tab==='identity'&&<button type="button" onClick={()=>setTab('content')} className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ws-action,#682943)]">{t("Lanjut ke panduan konten")} <ArrowRight size={16}/></button>}
  </div>;
}
