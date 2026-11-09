import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { adminBucket } from './firebase';
import { requireWorkspace, hasWorkspaceAccess } from './auth';
import { isVerifiedAdmin } from '../veloxa-workspace-policy';
import { ApiError, readJson } from './http';
import type { BrandVaultAsset } from '../veloxa-types';
type AssetRecord = { asset?: BrandVaultAsset; storagePath?: string; trashedAt?: number | null };
export function isWorkspacePhoto(record: AssetRecord | undefined, workspaceId: string): record is AssetRecord & { asset: BrandVaultAsset; storagePath: string } {
  const prefix = `workspaces/${workspaceId}/vault/`;
  return !!record?.asset && record.asset.workspaceId === workspaceId && typeof record.storagePath === 'string' && record.storagePath.startsWith(prefix) && /^[a-f0-9-]{36}\.jpg$/.test(record.storagePath.slice(prefix.length));
}
export function photoPreviewPath(workspaceId:string,id:string) {return `/api/veloxa/media/preview/?workspaceId=${encodeURIComponent(workspaceId)}&assetId=${encodeURIComponent(id)}`;}
export function publicBrandPhoto(record: AssetRecord & { asset: BrandVaultAsset }): BrandVaultAsset {
  const { trashedAt: _untrustedSnapshot, ...asset } = record.asset;
  return { ...asset, previewUrl:photoPreviewPath(asset.workspaceId,asset.id), ...(typeof record.trashedAt === 'number' && record.trashedAt > 0 ? { trashedAt: new Date(record.trashedAt).toISOString() } : {}) };
}
export async function listWorkspacePhotos(request: Request, workspaceId: unknown, includeTrash = false, dependencies: { authorize?: typeof requireWorkspace } = {}) {
  const { ref, workspaceId: id } = await (dependencies.authorize || requireWorkspace)(request, workspaceId);
  const docs = await ref.collection('server_assets').get();
  return docs.docs.map(doc => doc.data() as AssetRecord).filter(record => isWorkspacePhoto(record, id) && (includeTrash || !record.trashedAt)).map(record => publicBrandPhoto(record as AssetRecord & { asset: BrandVaultAsset }));
}

export async function persistWorkspacePhoto(ref: Awaited<ReturnType<typeof requireWorkspace>>['ref'], workspaceId:string, uid:string, bytes:Buffer, title:string, storage?:ReturnType<typeof adminBucket>) {
  const id=randomUUID();const storagePath=`workspaces/${workspaceId}/vault/${id}.jpg`;const bucket=storage||adminBucket();const file=bucket.file(storagePath);
  await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'image/jpeg',cacheControl:'private, no-store'}});
  const asset:BrandVaultAsset={id,workspaceId,title,description:'',drawer:'real_asset',mediaType:'photo',previewUrl:photoPreviewPath(workspaceId,id),aspectRatio:'4:5',tags:[],uploadedFrom:'web',createdAt:new Date().toISOString(),usedInPostsCount:0};
  const assetRef=ref.collection('server_assets').doc(id);
  try {await assetRef.create({asset,storagePath,createdBy:uid});}
  catch(error) {
    // An RPC timeout can arrive after a successful commit. Never delete on uncertainty.
    let confirmed:Awaited<ReturnType<typeof assetRef.get>>;
    try {confirmed=await assetRef.get();}catch{throw new ApiError(503,'Status unggahan belum dapat dipastikan. Muat ulang galeri sebelum mengunggah lagi.','photo_save_uncertain');}
    const stored=confirmed.data();
    if(confirmed.exists&&isWorkspacePhoto(stored,workspaceId)&&stored.asset.id===id&&stored.storagePath===storagePath)return publicBrandPhoto(stored);
    const code=(error as {code?:unknown})?.code;
    const definitelyRejected=[3,7,9,'invalid-argument','permission-denied','failed-precondition'].includes(code as number|string);
    if(!confirmed.exists&&definitelyRejected){await file.delete({ignoreNotFound:true}).catch(()=>{});throw new ApiError(503,'Foto belum tersimpan. Silakan unggah lagi.','photo_metadata_unavailable');}
    throw new ApiError(503,'Status unggahan belum dapat dipastikan. Muat ulang galeri sebelum mengunggah lagi.','photo_save_uncertain');
  }
  return asset;
}
export async function previewWorkspacePhoto(request:Request, workspaceId:unknown, assetId:unknown, dependencies:{authorize?:typeof requireWorkspace;storage?:ReturnType<typeof adminBucket>}={}) {
  const id=z.string().uuid().parse(assetId);const {ref,workspaceId:workspace}=await(dependencies.authorize||requireWorkspace)(request,workspaceId);
  const record=(await ref.collection('server_assets').doc(id).get()).data();
  if(!isWorkspacePhoto(record,workspace)||record.asset.id!==id)throw new ApiError(404,'Foto tidak ditemukan.');
  const[bytes]=await(dependencies.storage||adminBucket()).file(record.storagePath).download();
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}

const stateInput = z.object({ workspaceId: z.string(), assetId: z.string().uuid(), action: z.enum(['trash', 'restore']) }).strict();
export async function changeWorkspacePhotoState(request: Request, dependencies: { authorize?: typeof requireWorkspace } = {}) {
  const input = stateInput.parse(await readJson(request));
  const { ref, workspaceId, user } = await (dependencies.authorize || requireWorkspace)(request, input.workspaceId);
  const assetRef = ref.collection('server_assets').doc(input.assetId);
  return ref.firestore.runTransaction(async tx => {
    const [workspace, assetDoc] = await Promise.all([tx.get(ref), tx.get(assetRef)]);
    if (!hasWorkspaceAccess(user.uid, workspace.data() || {}, isVerifiedAdmin(user))) throw new ApiError(403, 'Anda tidak memiliki izin untuk workspace ini.');
    const record = assetDoc.data() as AssetRecord | undefined;
    if (!isWorkspacePhoto(record, workspaceId) || record.asset.id !== input.assetId) throw new ApiError(404, 'Foto tidak ditemukan di workspace ini.');
    const trashedAt = input.action === 'trash' ? record.trashedAt || Date.now() : null;
    tx.update(assetRef, { trashedAt, updatedAt: Date.now(), updatedBy: user.uid });
    // Keep original media intact. Saved drafts use their own rendered copies.
    return publicBrandPhoto({ ...record, trashedAt });
  });
}
