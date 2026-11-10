import type {BrandProfile,BrandOfferingItem} from './veloxa-types';
import {normalizeBrandProfile} from './veloxa-brand-profile';
export const ANALYSIS_STAGES={validation:'Memeriksa bisnis dan akun',profiles:'Membaca profil dan postingan',visuals:'Menganalisis foto dan warna',suggestions:'Menyusun usulan profil',review:'Menyiapkan hasil untuk ditinjau'} as const;
export type AnalysisStage=keyof typeof ANALYSIS_STAGES;
export const SUGGESTION_LABELS={businessDescription:'Tentang bisnis',category:'Bidang bisnis',city:'Area layanan',websiteUrl:'Website',targetAudience:'Target audiens',brandTone:'Gaya bahasa',defaultCta:'Ajakan bertindak',offerings:'Produk & layanan',visualVibe:'Gaya visual',palette:'Palet warna'} as const;
export type SuggestionKey=keyof typeof SUGGESTION_LABELS;
export interface BrandSource{id:string;label:string;text:string;kind:'profile'|'post'|'image'|'logo';connectionId?:string}
export interface BrandSuggestion{key:SuggestionKey;value:string|BrandOfferingItem[]|string[];sourceIds:string[];basis:'observed'|'inferred';reason:string}
export interface BrandAnalysis{workspaceId:string;businessId:string;baseFingerprint:string;suggestions:BrandSuggestion[];sources:BrandSource[];warnings:string[]}
export function emptySuggestionKeys(brand:BrandProfile,suggestions:BrandSuggestion[]):SuggestionKey[]{return suggestions.filter(item=>item.key==='palette'?!brand.useBrandPalette:item.key==='offerings'?!brand.offerings.length:item.key==='category'?brand.category==='custom':!String(brand[item.key]||'').trim()).map(item=>item.key);}
/** Copy explicitly checked suggestions into an editable form. Existing catalog facts win on matching titles. */
export function applyBrandSuggestions(brand:BrandProfile,result:BrandAnalysis,keys:SuggestionKey[]):BrandProfile{
 if(result.workspaceId!==brand.workspaceId||result.businessId!==(brand.businessId||'primary'))throw new Error('Usulan ini berasal dari bisnis lain.');
 const next={...brand,offerings:[...brand.offerings]};
 for(const item of result.suggestions.filter(item=>keys.includes(item.key))){
  if(item.key==='offerings'){for(const offering of item.value as BrandOfferingItem[]){if(!next.offerings.some(saved=>saved.title.trim().toLowerCase()===offering.title.trim().toLowerCase()))next.offerings.push({...offering,priceLabel:''});}if(next.offerings.length>30)throw new Error('Maksimal 30 produk. Pilih lebih sedikit usulan.');}
  else if(item.key==='palette'){const colors=item.value as string[];if(colors.length<1||colors.length>6||colors.some(color=>!/^#[A-F0-9]{6}$/i.test(color)))throw new Error('Palet usulan tidak valid.');next.useBrandPalette=true;next.primaryColorHex=colors[0];next.accentColorHex=colors[1]||'#FFFFFF';next.additionalColorHexes=colors.slice(2);}
  else Object.assign(next,{[item.key]:item.value});
 }
 return normalizeBrandProfile(next);
}
export async function readBrandAnalysisStream(response:Response,progress:(stage:AnalysisStage)=>void):Promise<BrandAnalysis>{
 const reader=response.body?.getReader();if(!reader)throw new Error('Respons analisis belum diterima.');const decoder=new TextDecoder();let pending='';
 function line(text:string):BrandAnalysis|undefined{if(!text.trim())return;const event=JSON.parse(text);if(event.type==='progress'&&Object.hasOwn(ANALYSIS_STAGES,event.stage))progress(event.stage);if(event.type==='error')throw new Error(event.error||'Analisis belum berhasil.');if(event.type==='complete'&&event.data?.baseFingerprint&&Array.isArray(event.data?.suggestions))return event.data;}
 try{for(;;){const {done,value}=await reader.read();pending+=decoder.decode(value,{stream:!done});if(pending.length>2*1024*1024)throw new Error('Hasil analisis terlalu besar.');let end:number;while((end=pending.indexOf('\n'))>=0){const result=line(pending.slice(0,end));pending=pending.slice(end+1);if(result)return result;}if(done){if(pending.trim()){const result=line(pending);if(result)return result;}throw new Error('Koneksi analisis terputus. Profil belum diubah; silakan coba lagi.');}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
