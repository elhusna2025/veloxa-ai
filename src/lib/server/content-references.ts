import sharp from 'sharp';
import {assetKindLabel, type AssetKind} from '../asset-kind';
import { assetBusiness, PRIMARY_BUSINESS } from '../business-context';
import { adminBucket } from './firebase';
import type { requireWorkspace } from './auth';
import { isWorkspacePhoto } from './brand-assets';
import { ApiError } from './http';
import { MAX_CONTENT_REFERENCES, MAX_REFERENCE_IMAGE_BYTES, MAX_REFERENCE_TOTAL_BYTES } from '../content-reference-options';
export interface ContentReference { id:string; title:string; bytes:Buffer; category?:AssetKind }
/** Only server-owned Storage paths are sources. Never download a client/provider URL. */
export async function loadContentReferences(ref: Awaited<ReturnType<typeof requireWorkspace>>['ref'], workspaceId:string, ids:string[], storage?:ReturnType<typeof adminBucket>,selectedBusiness=PRIMARY_BUSINESS):Promise<ContentReference[]> {
  if(ids.length>MAX_CONTENT_REFERENCES||new Set(ids).size!==ids.length)throw new ApiError(400, 'Pilihan referensi tidak valid.');
  if(!ids.length)return [];
  const result:ContentReference[]=[];let total=0;
  for(const id of ids){
    const record=(await ref.collection('server_assets').doc(id).get()).data();
    if(!isWorkspacePhoto(record,workspaceId)||record.asset.id!==id||assetBusiness(record.asset)!==selectedBusiness||record.trashedAt||record.asset.mediaType!=='photo')throw new ApiError(404,'Salah satu foto referensi tidak tersedia. Periksa pilihan atau pulihkan dari Sampah.');
    const remaining=Math.min(MAX_REFERENCE_IMAGE_BYTES,MAX_REFERENCE_TOTAL_BYTES-total);
    if(remaining<=0)throw new ApiError(413,'Ukuran referensi terlalu besar. Pilih lebih sedikit foto.');
    let bytes:Buffer;
    // GCS range ends are inclusive: read at most the allowed bytes plus one sentinel.
    try { [bytes]=await(storage||adminBucket()).file(record.storagePath).download({start:0,end:remaining}); }
    catch { throw new ApiError(503,'Foto referensi belum dapat dimuat. Periksa koneksi lalu coba lagi.','reference_media_unavailable'); }
    total+=bytes.length;
    if(!bytes.length||bytes.length>remaining||total>MAX_REFERENCE_TOTAL_BYTES)throw new ApiError(413,'Ukuran referensi terlalu besar. Pilih lebih sedikit foto.');
    try { const meta=await sharp(bytes,{limitInputPixels:30_000_000}).metadata();if(meta.format!=='jpeg'||!meta.width||!meta.height)throw new Error('unsupported'); }
    catch { throw new ApiError(400,'Salah satu foto referensi tidak dapat dibaca. Unggah ulang fotonya.'); }
    result.push({id,title:(record.asset.category?assetKindLabel(record.asset)+': ':'')+record.asset.title.slice(0,160),bytes,category:record.asset.category});
  }
  return result;
}
