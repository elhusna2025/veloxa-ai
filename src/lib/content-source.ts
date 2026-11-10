import type {BrandProfile} from './veloxa-types';
import {defaultContentTopic} from './veloxa-brand-profile';
export type ContentSourceMode='manual'|'offerings';
export const CONTENT_INTENTS={auto:'AI pilihkan',education:'Edukasi manfaat',introduction:'Perkenalan produk',promotion:'Promosi'} as const;
export type ContentIntent=keyof typeof CONTENT_INTENTS;
export interface OfferingContentSource {mode:'offerings';offeringIds:string[];offeringTitles:string[];intent:ContentIntent;instructions:string}
/** Resolve facts from this saved business, never product prose supplied by the client. */
export function resolveContentSource(brand:BrandProfile,input:{sourceMode?:ContentSourceMode;offeringIds?:string[];contentIntent?:ContentIntent;topic?:string}) {
 const mode=input.sourceMode||'manual';const ids=input.offeringIds||[];const notes=(input.topic||'').trim();
 if(!['manual','offerings'].includes(mode)||!Array.isArray(ids)||ids.length>30||ids.some(id=>typeof id!=='string'||!id||id.length>180)||new Set(ids).size!==ids.length||notes.length>1000||!Object.hasOwn(CONTENT_INTENTS,input.contentIntent||'auto'))throw new Error('Periksa sumber ide dan pilihan produk.');
 if(mode==='manual'){if(ids.length)throw new Error('Pilihan produk hanya digunakan pada mode Produk & layanan.');return{brand,topic:notes||defaultContentTopic(brand),focus:undefined,metadata:undefined};}
 if(!ids.length)throw new Error('Centang minimal satu produk atau layanan.');
 const offerings=ids.map(id=>{const matches=brand.offerings.filter(item=>item.id===id);if(matches.length!==1||!matches[0].title.trim())throw new Error('Salah satu produk tidak tersedia pada bisnis ini. Muat ulang pilihan produk.');return matches[0];});
 const intent=input.contentIntent||'auto';
 const metadata:OfferingContentSource={mode:'offerings',offeringIds:[...ids],offeringTitles:offerings.map(item=>item.title),intent,instructions:notes};
 return {brand:{...brand,offerings},topic:notes||`${intent==='auto'?'Buat konten relevan':CONTENT_INTENTS[intent]} tentang ${offerings[0].title.slice(0,200)}${offerings.length>1?` dan ${offerings.length-1} produk terkait lainnya`:''}`,focus:{ids:[...ids],intent},metadata};
}
