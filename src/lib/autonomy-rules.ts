import {z} from 'zod';
import type {BrandProfile,ContentFormat} from './veloxa-types';
import {BUSINESS_DAYS,type BusinessContext} from './business-context';
import {resolveReferenceRoles} from './content-reference-roles';
import {CONTENT_INTENTS,resolveContentSource,type ContentIntent} from './content-source';
export const AUTO_FORMATS={single_post:'Post tunggal',carousel:'Carousel',short_video:'Reels'} as const;
const unique=(items:string[])=>new Set(items).size===items.length;
export const autonomyConfigSchema=z.object({connectionIds:z.array(z.string().regex(/^(instagram|facebook)_\d{1,128}$/)).min(1).max(50).refine(unique),days:z.array(z.enum(BUSINESS_DAYS)).min(1).max(7).refine(unique),timesWib:z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(4).refine(unique).refine(items=>{const sorted=items.map(item=>Number(item.slice(0,2))*60+Number(item.slice(3))).sort((a,b)=>a-b);return sorted.every((value,i)=>!i||value-sorted[i-1]>=15);},'Beri jarak minimal 15 menit antarslot.'),sourceMode:z.enum(['profile','offerings','topics']),offeringIds:z.array(z.string().min(1).max(180)).max(30).refine(unique),topics:z.array(z.string().trim().min(1).max(240)).max(20),intent:z.enum(['auto','education','introduction','promotion']),formats:z.array(z.enum(['single_post','carousel','short_video'])).min(1).max(3).refine(unique),referenceAssetIds:z.array(z.string().uuid()).max(6).refine(unique),referenceRoles:z.record(z.string().uuid(),z.enum(['visual','logo','screenshot'])),referenceInstruction:z.string().trim().max(1000),directions:z.string().trim().max(500)}).strict();
export type AutoContentConfig=z.infer<typeof autonomyConfigSchema>;
export interface AutoContentRule{revision:number;enabled:boolean;config:AutoContentConfig;nextSlotMs:number;lastError?:string;processingJob?:string|null;processingUntil?:number;pausePending?:boolean;sequence?:number}
export interface AutoContentActivity{id:string;state:string;scheduledAt:number;topic?:string;format?:ContentFormat;draftId?:string;error?:string;receipts?:{handle?:string;accountName?:string;status:string;permalink?:string}[]}
export interface AutoContentStatus{rule:AutoContentRule|null;jobs:AutoContentActivity[];canManage:boolean;schedulerReady:boolean;lastTickAt:number|null}
export function initialAutonomyConfig(business:Pick<BusinessContext,'brand'|'schedule'>):AutoContentConfig{return{connectionIds:business.schedule.connectionIds,days:business.schedule.days as typeof BUSINESS_DAYS[number][],timesWib:business.schedule.timesWib,sourceMode:business.brand.offerings.length?'offerings':'profile',offeringIds:business.brand.offerings.map(item=>item.id),topics:[],intent:'education',formats:['single_post'],referenceAssetIds:[],referenceRoles:{},referenceInstruction:'',directions:''};}
/** Exclusive next slot in fixed UTC+7; no browser timezone, DST, catch-up burst or locale parsing. */
export function nextAutonomySlot(config:Pick<AutoContentConfig,'days'|'timesWib'>,after:number):number{
 if(!Number.isFinite(after)||!config.days.length||!config.timesWib.length)throw new Error('Jadwal belum valid.');
 const shifted=new Date(after+7*3600000);const dayStart=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate());const times=[...config.timesWib].sort();
 for(let offset=0;offset<15;offset++){const day=dayStart+offset*86400000;const label=BUSINESS_DAYS[(new Date(day).getUTCDay()+6)%7];if(!config.days.includes(label))continue;for(const time of times){const match=time.match(/^(\d{2}):(\d{2})$/);if(!match)throw new Error('Jam belum valid.');const value=day+Number(match[1])*3600000+Number(match[2])*60000-7*3600000;if(value>after)return value;}}
 throw new Error('Jadwal berikutnya belum tersedia.');
}
export function validateAutonomySource(config:AutoContentConfig,brand:BrandProfile){
 if(config.sourceMode==='offerings')resolveContentSource(brand,{sourceMode:'offerings',offeringIds:config.offeringIds});
 else if(config.sourceMode==='topics'){if(!config.topics.length)throw new Error('Isi minimal satu topik konten.');}
 else if(!(brand.businessDescription||'').trim()&&!brand.offerings.length)throw new Error('Lengkapi Tentang bisnis atau produk sebelum memakai ide dari profil.');
 resolveReferenceRoles(config.referenceAssetIds,config.referenceRoles);
 if(Object.keys(config.referenceRoles).some(id=>!config.referenceAssetIds.includes(id)))throw new Error('Peran foto harus sesuai referensi terpilih.');
}
const angles=['masalah sehari-hari audiens dan kaitannya dengan bisnis ini','satu manfaat konkret dan contoh penggunaan yang masuk akal','tips praktis yang membantu audiens memahami produk','penjelasan cara kerja fitur yang benar-benar tercantum di profil','pertanyaan umum dan jawaban yang didukung profil','perkenalan solusi untuk satu kebutuhan audiens'];
export function autonomyContentInput(config:AutoContentConfig,brand:BrandProfile,sequence:number,recent:string[]=[]){
 validateAutonomySource(config,brand);const format=config.formats[sequence%config.formats.length];const productIndex=sequence%Math.max(1,config.offeringIds.length);const selected=config.sourceMode==='offerings'?[config.offeringIds[productIndex]]:[];const product=brand.offerings.find(item=>item.id===selected[0]);const topic=config.sourceMode==='topics'?config.topics[sequence%config.topics.length]:`Bahas ${product?.title||brand.businessName}. Sudut konten: ${angles[Math.floor(sequence/(config.sourceMode==='offerings'?Math.max(1,config.offeringIds.length):1))%angles.length]}.`;
 const notes=[topic,`Tujuan konten: ${CONTENT_INTENTS[config.intent]}.`,config.directions,recent.length?`Hindari mengulang judul terbaru: ${recent.slice(0,5).map(value=>value.slice(0,80)).join('; ')}`:''].filter(Boolean).join('\n').slice(0,1000);
 return{workspaceId:brand.workspaceId,businessId:brand.businessId||'primary',selectedConnectionIds:config.connectionIds,format,topic:notes,sourceMode:config.sourceMode==='offerings'?'offerings' as const:'manual' as const,...(selected.length?{offeringIds:selected,contentIntent:config.intent as ContentIntent}:{}),referenceAssetIds:config.referenceAssetIds,referenceRoles:config.referenceRoles,referenceInstruction:config.referenceInstruction};
}
export const AUTO_ACTIVITY_LABELS:Record<string,string>={generating:'Membuat konten',publishing:'Mengirim ke akun tujuan',queued:'Melanjutkan akun berikutnya',published:'Terbit',failed:'Perlu diperiksa',cancelled:'Dibatalkan karena aturan berubah',skipped:'Slot terlewat',needs_attention:'Hasil belum pasti — periksa akun'};
