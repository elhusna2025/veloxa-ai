'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Expand} from 'lucide-react';
import {useWorkspaceCopy} from '@/lib/veloxa-workspace-copy';
import {workspaceCatalog} from '@/lib/workspace-catalog';
interface Props {images:{url:string;alt:string}[];title:string;testId?:string}
/** Native horizontal scroll preserves touch/trackpad gestures; buttons and keys cover keyboard/mouse. */
export function ContentMediaGallery({images,title,testId}:Props){
 const {t,dir}=useWorkspaceCopy(workspaceCatalog);
 const direction=dir==='rtl'?-1:1;
 const Previous=dir==='rtl'?ChevronRight:ChevronLeft;
 const Next=dir==='rtl'?ChevronLeft:ChevronRight;
 const [index,setIndex]=useState(0);const track=useRef<HTMLDivElement>(null);const signature=images.map(item=>item.url).join('\n');
 useEffect(()=>{setIndex(0);track.current?.scrollTo({left:0});},[signature,dir]);
 const current=Math.min(index,Math.max(0,images.length-1));
 function go(next:number){const clamped=Math.max(0,Math.min(images.length-1,next));setIndex(clamped);track.current?.scrollTo({left:direction*clamped*track.current.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 if(!images.length)return <p role="status" className="rounded-lg border p-4 text-neutral-600">{t("Visual belum tersedia.")}</p>;
 return <div className="mx-auto w-full max-w-[680px] space-y-3" aria-label={t("Galeri {title}",{title})}>
  <div ref={track} role="region" aria-label={images.length>1?`Carousel ${title}`:t("Visual {title}",{title})} aria-roledescription={images.length>1?'carousel':undefined} tabIndex={images.length>1?0:undefined} onKeyDown={event=>{if(event.target!==event.currentTarget||images.length<2)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();go(event.key==='Home'?0:event.key==='End'?images.length-1:current+direction*(event.key==='ArrowRight'?1:-1));}}} onScroll={()=>{const element=track.current;if(element?.clientWidth)setIndex(Math.max(0,Math.min(images.length-1,Math.round(direction*element.scrollLeft/element.clientWidth))));}} className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg border border-neutral-200 bg-neutral-100 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
   {images.map((image,i)=><div key={image.url+'-'+i} role={images.length>1?'group':undefined} aria-roledescription={images.length>1?'slide':undefined} aria-label={images.length>1?t("{index} dari {count}",{index:i+1,count:images.length}):undefined} className="w-full min-w-0 shrink-0 snap-center"><img src={image.url} alt={image.alt} data-testid={i===current?testId:undefined} draggable={false} className="aspect-[4/5] max-h-[70dvh] w-full object-contain"/></div>)}
  </div>
  {images.length>1&&<><div className="flex items-center justify-between gap-2"><button type="button" aria-label={t("Slide sebelumnya")} disabled={current===0} onClick={()=>go(current-1)} className="veloxa-button-secondary !px-3"><Previous size={19} aria-hidden="true"/><span className="hidden sm:inline">{t("Sebelumnya")}</span></button><span aria-live="polite" aria-atomic="true" className="text-sm font-medium tabular-nums text-neutral-600">{t("Slide {index} / {count}",{index:current+1,count:images.length})}</span><button type="button" aria-label={t("Slide berikutnya")} disabled={current===images.length-1} onClick={()=>go(current+1)} className="veloxa-button-secondary !px-3"><span className="hidden sm:inline">{t("Berikutnya")}</span><Next size={19} aria-hidden="true"/></button></div><div role="group" aria-label={t("Pilih slide carousel")} className="flex gap-2 overflow-x-auto pb-1">{images.map((image,i)=><button key={image.url+'-thumb-'+i} type="button" aria-label={t("Pilih slide {index}",{index:i+1})} aria-pressed={current===i} onClick={()=>go(i)} className={`w-14 shrink-0 overflow-hidden rounded-md border-2 sm:w-16 ${current===i?'border-[#a92e5d]':'border-transparent opacity-60 hover:opacity-100'}`}><img src={image.url} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover"/></button>)}</div></>}
  <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-500">{images.length>1&&<span>{t("Geser untuk melihat slide lainnya.")}</span>}<a href={images[current].url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 font-medium text-[#a92e5d]"><Expand size={16}/>{t("Buka ukuran penuh")}</a></div>
 </div>;
}
