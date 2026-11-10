export const ASSET_KINDS=[{value:'logo',label:'Logo'},{value:'product',label:'Foto produk'},{value:'screenshot',label:'Screenshot aplikasi'},{value:'person',label:'Orang / model'},{value:'event',label:'Kegiatan / event'},{value:'place',label:'Tempat / lokasi'},{value:'style',label:'Referensi gaya desain'},{value:'other',label:'Lainnya'}] as const;
export type AssetKind=typeof ASSET_KINDS[number]['value'];
export interface AssetKindMetadata{category:AssetKind;customCategoryLabel:string}
export function parseAssetKind(value:unknown):AssetKindMetadata{
 if(!value||typeof value!=='object')throw new Error('Pilih jenis aset.');const raw=value as Record<string,unknown>;
 if(!ASSET_KINDS.some(item=>item.value===raw.category))throw new Error('Jenis aset tidak valid.');
 if(raw.customCategoryLabel!==undefined&&typeof raw.customCategoryLabel!=='string')throw new Error('Nama kategori tidak valid.');
 const label=String(raw.customCategoryLabel||'').trim();if(label.length>80||raw.category==='other'&&!label)throw new Error('Isi kategori lainnya, maksimal 80 karakter.');
 return{category:raw.category as AssetKind,customCategoryLabel:raw.category==='other'?label:''};
}
export function assetKindLabel(asset:{category?:unknown;customCategoryLabel?:unknown}):string{try{const kind=parseAssetKind(asset);return kind.category==='other'?kind.customCategoryLabel:ASSET_KINDS.find(item=>item.value===kind.category)!.label;}catch{return'Belum dikategorikan';}}
export function assetMetadataRevision(raw:unknown):number{if(raw===undefined)return 0;if(!Number.isSafeInteger(raw)||Number(raw)<0||Number(raw)>=Number.MAX_SAFE_INTEGER)throw new Error('Revisi aset tidak valid. Muat ulang galeri.');return Number(raw);}
export interface AssetKindSuggestion{category:AssetKind;confidence:number;reason:string;assetId:string;businessId:string;metadataRevision:number}
