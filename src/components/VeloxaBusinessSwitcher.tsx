'use client';
import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {Building2,Check,ChevronDown,Settings2} from 'lucide-react';
import type {BusinessContext} from '@/lib/business-context';
import type {ChannelConnectionState} from '@/lib/veloxa-types';
interface Props {businesses:BusinessContext[];activeId:string;accounts:ChannelConnectionState[];locked:boolean;ready:boolean;error:string;onSelect:(id:string)=>void;onCreate:(name:string)=>Promise<void>;onAssign:(ids:string[])=>Promise<void>;onReload:()=>Promise<void>}
export function VeloxaBusinessSwitcher(props:Props){
 const active=props.businesses.find(item=>item.id===props.activeId);const[managing,setManaging]=useState(false);const[name,setName]=useState('');const[chosen,setChosen]=useState(active?.connectionIds||[]);const[busy,setBusy]=useState(false);const[feedback,setFeedback]=useState('');
 useEffect(()=>{setChosen(active?.connectionIds||[]);setFeedback('');},[props.activeId,active?.revision,active?.connectionIds]);
 const dirty=JSON.stringify([...chosen].sort())!==JSON.stringify([...(active?.connectionIds||[])].sort());
 const unassigned=props.accounts.filter(account=>account.connectionId&&!props.businesses.some(business=>business.connectionIds.includes(account.connectionId!)));
 const [pickerOpen,setPickerOpen]=useState(false);
 const [menuIndex,setMenuIndex]=useState(0);
 const pickerRef=useRef<HTMLDivElement>(null);
 const triggerRef=useRef<HTMLButtonElement>(null);
 const optionRefs=useRef<Array<HTMLButtonElement|null>>([]);
 const listId=useId();
 const selectedIndex=Math.max(0,props.businesses.findIndex(business=>business.id===props.activeId));
 const managementUnavailable=!props.ready||props.locked||busy||!active;
 const unavailable=managementUnavailable||dirty||!props.businesses.length;
 const activeName=active?.brand.businessName||(props.ready?'Belum ada bisnis':'Memuat bisnis…');
 const initials=(value:string)=>value.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]||'').join('').toUpperCase()||'B';
 useEffect(()=>{setPickerOpen(false);},[props.activeId,unavailable]);
 useEffect(()=>{setMenuIndex(index=>Math.min(index,Math.max(0,props.businesses.length-1)));},[props.businesses.length]);
 useEffect(()=>{if(!pickerOpen)return;const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!pickerRef.current?.contains(event.target))setPickerOpen(false);};document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[pickerOpen]);
 useEffect(()=>{if(pickerOpen)optionRefs.current[menuIndex]?.scrollIntoView({block:'nearest'});},[pickerOpen,menuIndex]);
 function chooseBusiness(id:string){if(unavailable)return;setPickerOpen(false);triggerRef.current?.focus();if(id!==props.activeId)props.onSelect(id);}
 function onPickerKeyDown(event:KeyboardEvent<HTMLButtonElement>){
  if(unavailable)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setMenuIndex(index=>pickerOpen?(index+(event.key==='ArrowDown'?1:-1)+props.businesses.length)%props.businesses.length:selectedIndex);setPickerOpen(true);}
  else if(event.key==='Home'||event.key==='End'){event.preventDefault();setMenuIndex(event.key==='Home'?0:props.businesses.length-1);setPickerOpen(true);}
  else if(event.key==='Enter'||event.key===' '){event.preventDefault();if(pickerOpen){const business=props.businesses[menuIndex];if(business)chooseBusiness(business.id);}else{setMenuIndex(selectedIndex);setPickerOpen(true);}}
  else if(event.key==='Escape'&&pickerOpen){event.preventDefault();event.stopPropagation();setPickerOpen(false);}
  else if(event.key==='Tab')setPickerOpen(false);
 }
 async function run(action:()=>Promise<void>){setBusy(true);setFeedback('');try{await action();}catch(error){setFeedback(error instanceof Error?error.message:'Perubahan belum tersimpan.');}finally{setBusy(false);}}
 return <section aria-label="Konteks bisnis" className="relative mb-6 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm sm:p-4">
  <div className="flex items-center justify-between gap-2 sm:gap-4">
   <div ref={pickerRef} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setPickerOpen(false);}} className="relative min-w-0 flex-1 sm:max-w-[420px]">
    <button ref={triggerRef} type="button" role="combobox" aria-label={`Pilih bisnis aktif: ${activeName}`} aria-expanded={pickerOpen} aria-haspopup="listbox" aria-controls={pickerOpen?listId:undefined} aria-activedescendant={pickerOpen&&props.businesses[menuIndex]?`${listId}-${menuIndex}`:undefined} disabled={unavailable} onClick={()=>{setMenuIndex(selectedIndex);setPickerOpen(value=>!value);}} onKeyDown={onPickerKeyDown} className="group flex min-h-16 w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition hover:border-neutral-200 hover:bg-neutral-50 disabled:hover:bg-white">
     <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-sm font-semibold tracking-wide text-white">{active?initials(active.brand.businessName):<Building2 size={20}/>}</span>
     <span className="min-w-0 flex-1"><span className="mb-0.5 flex flex-wrap items-center gap-x-2 text-xs font-medium text-neutral-500"><span>Bisnis aktif</span><span aria-hidden="true" className="text-neutral-300">·</span><span>{props.businesses.length} bisnis</span></span><span className="block truncate text-base font-semibold tracking-tight text-neutral-900 sm:text-lg" title={active?.brand.businessName}>{activeName}</span></span>
     <span className="hidden shrink-0 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 min-[420px]:inline-block">{active?.connectionIds.length||0} akun</span>
     <ChevronDown aria-hidden="true" size={18} className={`shrink-0 text-neutral-400 transition ${pickerOpen?'rotate-180':''}`}/>
    </button>
    {pickerOpen&&<div className="absolute left-0 top-[calc(100%+8px)] z-50 w-full min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_16px_48px_rgba(0,0,0,0.12)] sm:w-[420px]">
     <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3"><span className="text-sm font-semibold text-neutral-900">Pilih bisnis</span><span className="text-xs text-neutral-500">{props.businesses.length} tersedia</span></div>
     <div id={listId} role="listbox" aria-label="Daftar bisnis" className="max-h-[min(320px,50dvh)] space-y-1 overflow-y-auto p-2">{props.businesses.map((business,index)=>{const selected=business.id===props.activeId;return <button key={business.id} ref={node=>{optionRefs.current[index]=node;}} id={`${listId}-${index}`} type="button" role="option" aria-selected={selected} tabIndex={-1} disabled={unavailable} onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setMenuIndex(index)} onClick={()=>chooseBusiness(business.id)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${selected?'border-[#edc9d7] bg-[#fbf3f6]':'border-transparent hover:bg-neutral-50'} ${index===menuIndex?'ring-1 ring-inset ring-[#a92e5d]':''}`}>
      <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${selected?'bg-[#a92e5d] text-white':'bg-neutral-100 text-neutral-600'}`}>{initials(business.brand.businessName)}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold leading-snug text-neutral-900 sm:text-base">{business.brand.businessName}</span><span className="mt-1 block text-xs text-neutral-500">{business.connectionIds.length} akun sosial</span></span>{selected&&<Check aria-hidden="true" size={19} className="shrink-0 text-[#a92e5d]"/>}
     </button>;})}</div>
     <p className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 text-xs leading-relaxed text-neutral-500">Profil dan konten terpisah per bisnis. Kuota workspace dipakai bersama.</p>
    </div>}
   </div>
   {active&&<button type="button" aria-label={managing?'Tutup pengaturan bisnis':'Kelola bisnis'} disabled={managementUnavailable} onClick={()=>{setPickerOpen(false);setManaging(value=>!value);}} className="veloxa-button-secondary shrink-0 !px-3 sm:!px-4"><Settings2 aria-hidden="true" size={17}/><span className="sr-only sm:not-sr-only">{managing?'Tutup pengaturan':'Kelola bisnis'}</span></button>}
  </div>
  {dirty&&!props.locked&&<p role="status" className="mt-2 px-2 text-sm text-amber-700">Simpan atau batalkan pilihan akun sebelum mengganti bisnis.</p>}
 {props.error&&<p role="alert" className="mt-3 text-sm text-red-700">{props.error} <button type="button" onClick={()=>void run(props.onReload)} className="underline">Muat ulang bisnis</button></p>}
 {!managing&&active&&unassigned.length>0&&<button type="button" disabled={managementUnavailable} onClick={()=>setManaging(true)} className="mt-3 text-sm font-medium text-[#a92e5d]">{unassigned.length} akun belum ditautkan ke bisnis · Atur akun</button>}
 {managing&&active&&<div className="mt-5 space-y-5 border-t border-neutral-100 pt-5"><fieldset disabled={managementUnavailable} className="space-y-3"><legend className="text-base font-semibold">Akun sosial untuk {active.brand.businessName}</legend><p className="text-sm text-neutral-500">Satu akun hanya ditautkan ke satu bisnis. Instagram dan Facebook dari bisnis yang sama dapat dipilih bersama.</p><div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">{props.accounts.filter(account=>account.connectionId).map(account=>{const owner=props.businesses.find(item=>item.id!==active.id&&item.connectionIds.includes(account.connectionId!));return <label key={account.connectionId} className={`flex items-center gap-3 rounded-lg border p-3 ${owner?'bg-neutral-50 text-neutral-500':'bg-white'}`}><input type="checkbox" aria-label={`Tautkan ${account.channel} ${account.handle||account.accountName}`} checked={!owner&&chosen.includes(account.connectionId!)} disabled={Boolean(owner)} onChange={event=>setChosen(previous=>event.target.checked?[...previous,account.connectionId!]:previous.filter(id=>id!==account.connectionId))} className="h-5 w-5 shrink-0 accent-[#a92e5d]"/><span className="min-w-0 break-words text-sm"><strong className="block font-medium">{account.handle||account.accountName}</strong>{account.channel==='facebook'?'Facebook Page':'Instagram'}{owner?` · Milik ${owner.brand.businessName}`:!account.connected?' · Perlu hubungkan ulang':''}</span></label>;})}</div>{!props.accounts.some(account=>account.connectionId)&&<p className="text-sm text-neutral-500">Hubungkan akun melalui menu Akun sosial terlebih dahulu.</p>}<div className="flex flex-wrap gap-2"><button type="button" disabled={!dirty} onClick={()=>{if(managementUnavailable||!dirty)return;void run(()=>props.onAssign(chosen));}} className="veloxa-button-primary">{busy?'Menyimpan…':'Simpan akun bisnis'}</button>{dirty&&<button type="button" onClick={()=>setChosen(active.connectionIds)} className="veloxa-button-secondary">Batalkan pilihan</button>}</div></fieldset><form onSubmit={event=>{event.preventDefault();if(managementUnavailable||dirty||!name.trim())return;void run(async()=>{await props.onCreate(name.trim());setName('');});}} className="border-t border-neutral-100 pt-4"><label htmlFor="new-business-name" className="text-base font-semibold">Tambah bisnis terpisah</label><p className="mt-1 text-sm text-neutral-500">Bisnis baru dimulai dengan profil dan galeri kosong.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input id="new-business-name" required maxLength={110} value={name} disabled={managementUnavailable||dirty} onChange={event=>setName(event.target.value)} placeholder="Misalnya: Cendekia AI" className="min-w-0 flex-1 rounded-lg border px-3 py-3 text-base"/><button disabled={!name.trim()||managementUnavailable||dirty} className="veloxa-button-secondary">Tambah bisnis</button></div></form></div>}
 {feedback&&<p role="alert" className="mt-3 text-sm text-red-700">{feedback}</p>}{props.locked&&<p className="mt-2 text-xs text-neutral-500">Selesaikan proses atau simpan/batalkan perubahan profil sebelum mengganti bisnis.</p>}</section>;
}
