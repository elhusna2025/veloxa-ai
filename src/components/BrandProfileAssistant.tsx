'use client';
import { useWorkspaceCopy } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';
import {useEffect,useId,useRef,useState} from 'react';
import {Sparkles,Loader2,ArrowDownToLine,X} from 'lucide-react';
import type {BrandProfile,ChannelConnectionState} from '@/lib/veloxa-types';
import {ANALYSIS_STAGES,BRAND_ANALYSIS_POST_LIMIT,SUGGESTION_LABELS,emptySuggestionKeys,offeringSuggestionChanges,type AnalysisStage,type BrandAnalysis,type BrandSuggestion,type SuggestionKey} from '@/lib/brand-analysis';
import {businessCategoryLabel} from '@/lib/business-categories';
import {savedBrandPalette} from '@/lib/brand-visual-dna';
interface Props {
 brand: BrandProfile;
 accounts: ChannelConnectionState[];
 ready: boolean;
 disabled: boolean;
 dirty: boolean;
 profileFormId: string;
 saving: boolean;
 onDiscard: () => void;
 onAnalyze: (ids: string[], progress: (stage: AnalysisStage) => void) => Promise<BrandAnalysis>;
 onApply: (result: BrandAnalysis, keys: SuggestionKey[], offeringIds: string[]) => Promise<void>;
}
function Value({suggestion}:{suggestion:BrandSuggestion}){
 return <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-neutral-700">{suggestion.key==='category'?businessCategoryLabel(String(suggestion.value)):String(suggestion.value)}</p>;
}
function PaletteSwatches({colors}:{colors:string[]}){
 return <div className="flex flex-wrap gap-x-4 gap-y-2">
  {colors.map(color=><span key={color} className="inline-flex items-center gap-2 text-sm">
   <span aria-hidden="true" style={{backgroundColor:color}} className="h-6 w-6 rounded border border-neutral-200"/>
   <span dir="ltr">{color}</span>
  </span>)}
 </div>;
}
export function BrandProfileAssistant(props:Props){
 const {t}=useWorkspaceCopy(workspaceCatalog);

 const[open,setOpen]=useState(false);const[accounts,setAccounts]=useState<string[]>([]);const[result,setResult]=useState<BrandAnalysis|null>(null);const[selected,setSelected]=useState<SuggestionKey[]>([]);const[stage,setStage]=useState<AnalysisStage|null>(null);const[error,setError]=useState('');const[message,setMessage]=useState('');
 const [selectedOfferings,setSelectedOfferings]=useState<string[]>([]);
 const palette=result?.suggestions.find(item=>item.key==='palette');
 const savedColors=result&&!palette?savedBrandPalette(props.brand):[];
 const offeringGroup=result?.suggestions.find(item=>item.key==='offerings');
 const offeringChanges=offeringSuggestionChanges(props.brand,result?.suggestions||[]);
 const totalSelected=selected.length+selectedOfferings.length;
 const sourceLabels=(ids:string[])=>ids.map(id=>result?.sources.find(source=>source.id===id)?.label).filter(Boolean).join(', ');
 function toggleSuggestion(key:SuggestionKey,checked:boolean){
  setSelected(previous=>checked?[...previous,key]:previous.filter(item=>item!==key));
 }
 const blockerId = useId();
 const analyzeButton = useRef<HTMLButtonElement>(null);
 const returnFocusAfterChanges = useRef(false);
 const tooManyAccounts = accounts.length > 10;
 const blocker = props.dirty ? 'Simpan atau batalkan perubahan formulir sebelum menganalisis atau menyalin usulan.'
  : !accounts.length ? 'Pilih minimal satu akun untuk dianalisis.'
    : tooManyAccounts ? 'Pilih maksimal 10 akun untuk dianalisis.' : '';
 useEffect(() => {
  if (props.dirty || props.disabled || !returnFocusAfterChanges.current) return;
  returnFocusAfterChanges.current = false;
  if (document.activeElement === document.body) analyzeButton.current?.focus();
 }, [props.dirty, props.disabled]);
 const eligible=props.accounts.filter(account=>account.connected&&account.connectionId);const signature=eligible.map(account=>account.connectionId).join(',');
 useEffect(()=>{setAccounts(eligible.slice(0,10).map(account=>account.connectionId!));setResult(null);},[signature]);
 useEffect(()=>{setResult(null);setError('');setMessage('');},[props.brand]);
 async function analyze(){
  setError('');setMessage('');setResult(null);setStage('validation');
  try{
   const value=await props.onAnalyze(accounts,setStage);
   setSelected(emptySuggestionKeys(props.brand,value.suggestions));
   setSelectedOfferings(offeringSuggestionChanges(props.brand,value.suggestions).filter(item=>item.checkedByDefault).map(item=>item.proposed.id));
   setResult(value);
  }catch(error){setError(error instanceof Error?error.message:'Analisis belum berhasil.');}finally{setStage(null);}
 }
 async function apply(){setError('');try{await props.onApply(result!,selected,selectedOfferings);setResult(null);setMessage('Usulan disalin ke formulir. Periksa isinya, lalu Simpan profil untuk menggunakannya pada konten.');}catch(error){setError(error instanceof Error?error.message:'Usulan belum dapat diterapkan.');}}
 return <section aria-label={t("Bantuan AI profil")} className="veloxa-panel p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div className="max-w-2xl"><h3 className="flex items-center gap-2 text-lg font-semibold"><Sparkles size={20} className="text-[#a92e5d]"/>{t("Kenali bisnis dari akun sosial")}</h3><p className="mt-2 text-sm leading-relaxed text-neutral-500">{t("AI membaca bio, hingga {count} postingan terbaru per akun, serta sampel visual untuk mengusulkan profil, produk, dan DNA warna. Anda meninjau sebelum menyimpan.",{count:BRAND_ANALYSIS_POST_LIMIT})}</p></div><button type="button" disabled={props.disabled} aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="veloxa-button-secondary">{open?t("Tutup usulan"):t("Lengkapi dengan AI")}</button></div>
 {open&&<div className="mt-5 border-t pt-5">{!props.ready?<p role="status" className="text-sm text-neutral-500">{t("Memeriksa akun bisnis…")}</p>:!eligible.length?<p className="text-sm text-neutral-600">{t("Hubungkan dan tautkan akun bisnis ini melalui menu Akun sosial terlebih dahulu.")}</p>:<>
  <fieldset disabled={props.disabled || !!stage} className="flex flex-wrap gap-3">
   <legend className="mb-3 text-sm font-medium">{t('Akun sumber ·')} {props.brand.businessName}</legend>
   {eligible.map(account => <label key={account.connectionId} className={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${accounts.includes(account.connectionId!) ? 'border-[#bd416e] bg-[#faf2f5]' : ''}`}>
    <input type="checkbox" className="shrink-0 accent-[#a92e5d]" checked={accounts.includes(account.connectionId!)} onChange={event => {
     setResult(null);setError('');
     const checked=event.target.checked;
     setAccounts(previous => checked ? [...previous, account.connectionId!] : previous.filter(id => id !== account.connectionId));
    }} />
    <span className="min-w-0 break-words">{account.handle || account.accountName} · {account.channel}</span>
   </label>)}
  </fieldset>
  <p className="mt-3 text-sm text-neutral-500">{t('Hanya akun pada bisnis ini. Maksimal 10 akun per analisis; informasi yang tidak dapat dibaca akan dijelaskan.')}</p>
  {blocker && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
   <p id={blockerId} role="status" className="text-sm text-amber-900">{t(blocker)}</p>
   {props.dirty && <div className="mt-3 flex flex-wrap gap-2">
    <button type="submit" form={props.profileFormId} disabled={props.disabled} onClick={() => { returnFocusAfterChanges.current = true; }} className="veloxa-button-primary">
     {props.saving && <Loader2 size={18} className="animate-spin" aria-hidden="true" />} {t(props.saving ? 'Menyimpan…' : 'Simpan profil')}
    </button>
    <button type="button" disabled={props.disabled} onClick={() => {
     returnFocusAfterChanges.current = true;
     props.onDiscard();
    }} className="veloxa-button-secondary">{t('Batalkan perubahan')}</button>
   </div>}
  </div>}
  <button ref={analyzeButton} type="button" aria-describedby={blocker ? blockerId : undefined} disabled={props.disabled || !!blocker || !!stage} onClick={() => void analyze()} className="veloxa-button-primary mt-4">
   {stage ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />} {t(stage ? 'Menganalisis…' : 'Analisis akun terpilih')}
  </button>
 </>}
 {stage&&<p role="status" aria-live="polite" className="mt-4 flex items-center gap-2 text-base text-[#a92e5d]"><Loader2 size={18} className="animate-spin"/>{t(ANALYSIS_STAGES[stage])}</p>}
 {error&&<p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t(error)}</p>}{message&&<p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{t(message)}</p>}
 {result&&<div className="mt-5 space-y-4"><div><h4 className="text-lg font-semibold">{t("Tinjau usulan AI")}</h4><p className="mt-1 text-sm text-neutral-500">{t("Isian kosong dicentang otomatis. Centang isian lain yang ingin Anda perbarui.")}</p></div>{result.warnings.length>0&&<ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-4 pl-8 text-sm text-amber-900">{result.warnings.map((warning,index)=><li key={index}>{t(warning)}</li>)}</ul>}
 <div className={`rounded-lg border px-4 pb-4 ${palette&&selected.includes('palette')?'border-[#bd416e] bg-[#fdf9fb]':'border-neutral-200'}`}>
  {palette ? <>
   <label className="flex min-h-11 cursor-pointer items-center gap-2">
    <input type="checkbox" className="shrink-0 accent-[#a92e5d]" checked={selected.includes('palette')} disabled={props.disabled||props.dirty} onChange={event=>toggleSuggestion('palette',event.target.checked)}/>
    <strong className="text-base font-semibold">{t("Palet warna")}</strong>
    <span className="ms-auto text-xs text-neutral-500">{t(palette.basis==='observed'?'Dari sumber':'Saran AI')}</span>
   </label>
   <PaletteSwatches colors={palette.value as string[]}/>
   <p className="mt-3 text-sm leading-relaxed text-neutral-500">{t(palette.reason)}</p>
   <p className="mt-1 break-words text-sm text-neutral-500">{t("Sumber:")} {sourceLabels(palette.sourceIds)}</p>
  </> : <>
   <h5 className="py-3 text-base font-semibold">{t("Palet warna")}</h5>
   {savedColors.length>0&&<PaletteSwatches colors={savedColors}/>}
   <p className={`text-sm leading-relaxed text-neutral-500 ${savedColors.length?'mt-3':''}`}>
    {t(savedColors.length?'Palet dari DNA visual yang sudah tersimpan.':'Warna belum bisa diambil dari foto akun. Pilih logo di DNA visual untuk mengambil warnanya.')}
   </p>
  </>}
 </div>
 <fieldset disabled={props.disabled||props.dirty} className="grid items-start gap-3 lg:grid-cols-2">{result.suggestions.filter(item=>item.key!=='offerings'&&item.key!=='palette').map(item=><label key={item.key} className={`block min-w-0 cursor-pointer rounded-lg border p-4 ${selected.includes(item.key)?'border-[#bd416e] bg-[#fdf9fb]':'border-neutral-200'}`}><div className="mb-3 flex items-center gap-2"><input type="checkbox" className="accent-[#a92e5d]" checked={selected.includes(item.key)} onChange={event=>toggleSuggestion(item.key,event.target.checked)}/><strong className="text-base font-semibold">{t(SUGGESTION_LABELS[item.key])}</strong><span className="ms-auto text-xs text-neutral-500">{item.basis==='observed'?t("Dari sumber"):t("Saran AI")}</span></div><Value suggestion={item}/><p className="mt-3 text-sm leading-relaxed text-neutral-500">{item.reason}</p><p className="mt-2 break-words text-sm text-neutral-500">{t("Sumber:")} {sourceLabels(item.sourceIds)}</p></label>)}</fieldset>
 {offeringChanges.length>0&&<fieldset disabled={props.disabled||props.dirty} className="space-y-3">
  <legend className="mb-1 text-lg font-semibold">{t(SUGGESTION_LABELS.offerings)}</legend>
  <p className="text-sm text-neutral-500">{t("Pilih produk yang ingin ditambahkan atau deskripsi produk yang ingin diperbarui.")}</p>
  {offeringChanges.map(({proposed,existing})=>{
   const checked=selectedOfferings.includes(proposed.id);
   return <article key={proposed.id} className={`min-w-0 rounded-lg border px-4 pb-4 ${checked?'border-[#bd416e] bg-[#fdf9fb]':'border-neutral-200'}`}>
    <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-0 py-2">
     <input type="checkbox" className="shrink-0 accent-[#a92e5d]" checked={checked} onChange={event=>{
      const checked=event.target.checked;
      setSelectedOfferings(previous=>checked?[...previous,proposed.id]:previous.filter(id=>id!==proposed.id));
     }} />
     <strong className="min-w-0 break-words text-base">{proposed.title}</strong>
     <span className="ms-auto text-xs text-neutral-500">{t(existing?'Perbarui deskripsi':'Penawaran baru')}</span>
    </label>
    <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-neutral-700">{proposed.highlight}</p>
    <p className="mt-2 break-words text-sm text-neutral-500">{t("Sumber:")} {sourceLabels(proposed.sourceIds||offeringGroup?.sourceIds||[])}</p>
    {existing?.highlight&&<details className="mt-2 text-sm">
     <summary className="flex min-h-11 cursor-pointer items-center font-medium text-neutral-600">{t("Lihat deskripsi tersimpan")}</summary>
     <p className="whitespace-pre-wrap break-words text-neutral-600">{existing.highlight}</p>
    </details>}
   </article>;
  })}
 </fieldset>}
 <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">{t("Lihat bahan yang dibaca (")}{result.sources.length})</summary><div className="mt-3 max-h-64 space-y-3 overflow-auto">{result.sources.map(source=><article key={source.id}><h5 className="font-medium">{source.label}</h5><p className="mt-1 whitespace-pre-wrap text-neutral-500">{source.text}</p></article>)}</div></details>
 <div className="flex flex-wrap gap-3"><button type="button" disabled={props.disabled||props.dirty||!totalSelected} onClick={()=>void apply()} className="veloxa-button-primary"><ArrowDownToLine size={18}/>{t("Gunakan")} {totalSelected} {t("usulan di formulir")}</button><button type="button" disabled={props.disabled} onClick={()=>setResult(null)} className="veloxa-button-secondary"><X size={17}/>{t("Abaikan usulan")}</button></div><p className="text-sm text-neutral-500">{t("Belum ada perubahan yang disimpan. Foto profil tidak otomatis dijadikan logo; pilih file logo pada DNA visual.")}</p>
 </div>}</div>}
 </section>;
}
