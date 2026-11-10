import sharp from 'sharp';
import { businessId } from '../business-context';
import { z } from 'zod';
import { requireWorkspace } from './auth';
import { loadContentReferences } from './content-references';
import { ApiError, readJson } from './http';
/** Small bounded RGB sample; no AI call, quota mutation, external URL or public media link. */
export async function extractLogoPalette(bytes: Buffer): Promise<string[]> {
  let data: Buffer;
  try { data = await sharp(bytes, { limitInputPixels: 30_000_000 }).rotate().resize(128, 128, { fit: 'inside', withoutEnlargement: true }).toColourspace('srgb').ensureAlpha().raw().toBuffer(); }
  catch { throw new ApiError(400, 'Logo tidak dapat dibaca. Pilih foto logo lain.'); }
  const buckets = new Map<string, { count: number; rgb: number[] }>();
  // Abaikan piksel transparan; latar transparan tidak boleh berubah menjadi warna sampel.
  for (let i=0;i+3<data.length;i+=4) {
    if (data[i+3] < 16) continue;
    const rgb=[data[i],data[i+1],data[i+2]]; const key=rgb.map(v=>Math.floor(v/24)).join(',');
    const entry=buckets.get(key)||{count:0,rgb:[0,0,0]};entry.count++;rgb.forEach((v,n)=>entry.rgb[n]+=v);buckets.set(key,entry);
  }
  const ranked=[...buckets.values()].map(entry=>({count:entry.count,rgb:entry.rgb.map(v=>Math.round(v/entry.count))})).sort((a,b)=>b.count-a.count);
  const meaningful=ranked.filter(({rgb})=>Math.max(...rgb)-Math.min(...rgb)>25 && Math.min(...rgb)<235 && Math.max(...rgb)>20);
  const candidates=meaningful.length?meaningful:ranked;
  const chosen:number[][]=[];
  for(const {rgb} of candidates) {
    if(chosen.every(other=>Math.hypot(...rgb.map((v,n)=>v-other[n]))>55))chosen.push(rgb);
    if(chosen.length===6)break;
  }
  if(!chosen.length)throw new ApiError(400,'Warna logo belum dapat dibaca. Pilih warna secara manual.');
  return chosen.map(rgb=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase());
}
const input=z.object({workspaceId:z.string().min(1),businessId:z.string().optional(),assetId:z.string().uuid()});
export async function analyzeBrandLogo(request:Request, dependencies: { authorize?:typeof requireWorkspace; storage?:Parameters<typeof loadContentReferences>[3] }={}) {
  const body=input.parse(await readJson(request));
  const {ref,workspaceId}=await(dependencies.authorize||requireWorkspace)(request,body.workspaceId);
  const [photo]=await loadContentReferences(ref,workspaceId,[body.assetId],dependencies.storage,businessId(body.businessId));
  return {colors:await extractLogoPalette(photo.bytes)};
}
