'use client';
import { useEffect, useRef, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { veloxaApiBlob } from '@/lib/veloxa-api-client';
import type { BrandVaultAsset } from '@/lib/veloxa-types';
/** Lazy, authenticated previews. Never fall back to legacy public download links. */
export function AuthenticatedBrandPhoto({asset,alt='',className=''}:{asset:BrandVaultAsset;alt?:string;className?:string}){
 const element=useRef<HTMLDivElement>(null);const[url,setUrl]=useState('');const[error,setError]=useState(false);const[loading,setLoading]=useState(false);
 useEffect(()=>{let active=true;let objectUrl='';let started=false;const abort=new AbortController();setUrl('');setError(false);setLoading(false);
  const load=async()=>{if(started)return;started=true;setLoading(true);try{const blob=await veloxaApiBlob(`/api/veloxa/media/preview/?workspaceId=${encodeURIComponent(asset.workspaceId)}&assetId=${encodeURIComponent(asset.id)}`,{signal:abort.signal});if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}catch{if(active)setError(true);}finally{if(active)setLoading(false);}};
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){void load();observer?.disconnect();}},{rootMargin:'200px'});
  if(observer&&element.current)observer.observe(element.current);else void load();
  return()=>{active=false;abort.abort();observer?.disconnect();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[asset]);
 return <div ref={element} className={`relative grid overflow-hidden place-items-center bg-neutral-50 ${className}`}>{url?<img src={url} alt={alt} className="absolute inset-0 h-full w-full object-contain"/>:error?<span role="img" aria-label={alt||'Foto belum dapat dimuat'} className="flex flex-col items-center gap-2 p-3 text-center text-sm text-neutral-400"><ImageOff size={23}/>Foto belum dapat dimuat</span>:loading?<Loader2 size={22} className="animate-spin text-neutral-300" aria-label="Memuat foto"/>:null}</div>;
}
