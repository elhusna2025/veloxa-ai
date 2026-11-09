import type { BrandProfile, BrandOfferingItem } from './veloxa-types';
import { businessCategoryLabel } from './business-categories';
export const MAX_BUSINESS_CONTEXT_CHARS=24000;
export interface VisualBusinessContext {
 description:string; audience:string; topic:string;
 category?:string; serviceArea?:string; brandTone?:string; websiteUrl?:string;
 offerings?:BrandOfferingItem[];
}
export function validateVisualBusinessContext(context: VisualBusinessContext): void {
 if(!context||typeof context!=='object')throw new Error('Konteks profil bisnis tidak valid.');
 for(const [key,max] of [['description',2000],['audience',500],['topic',1000],['category',200],['serviceArea',250],['brandTone',250],['websiteUrl',2048]] as const){
  const value=context[key];if(value===undefined&&!['description','audience','topic'].includes(key))continue;
  if(typeof value!=='string'||value.length>max)throw new Error('Ada isian profil terlalu panjang atau tidak valid. Ringkas isian di Profil & aset, lalu simpan.');
 }
 if(context.offerings!==undefined){
  if(!Array.isArray(context.offerings)||context.offerings.length>100)throw new Error('Simpan maksimal 100 produk atau layanan dalam satu profil.');
  for(const item of context.offerings)if(!item||typeof item.title!=='string'||typeof item.highlight!=='string'||typeof item.priceLabel!=='string')throw new Error('Periksa nama, penjelasan, dan harga produk di Profil & aset.');
 }
 if(JSON.stringify(context).length>MAX_BUSINESS_CONTEXT_CHARS)throw new Error('Profil dan penjelasan produk terlalu panjang untuk satu pembuatan konten. Ringkas penjelasan produk di Profil & aset, lalu simpan. Tidak ada produk yang dipotong otomatis.');
}
export function buildVisualBusinessContext(brand: BrandProfile, topic:string): VisualBusinessContext {
 const context={description:brand.businessDescription||'',audience:brand.targetAudience,topic,category:businessCategoryLabel(brand.category),serviceArea:brand.city,brandTone:brand.brandTone,websiteUrl:brand.websiteUrl,offerings:brand.offerings};
 validateVisualBusinessContext(context);return context;
}
