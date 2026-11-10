import { requireWorkspace } from './auth';
import { adminDb } from './firebase';
import { ApiError } from './http';
import { z } from 'zod';
export async function disconnectAllSocial(request:Request,workspaceId:unknown,instagramOnly:boolean,deps:{authorize?:typeof requireWorkspace;database?:ReturnType<typeof adminDb>}={}){
 const{ref,user}=await(deps.authorize||requireWorkspace)(request,workspaceId,true);
 await(deps.database||adminDb()).runTransaction(async tx=>{
  const workspace=(await tx.get(ref)).data();const raw=await tx.get(ref.collection('private_meta_connections'));const grants=await tx.get(ref.collection('instagram_authorizations'));const pages=instagramOnly?null:await tx.get(ref.collection('meta_authorizations'));
  const names=instagramOnly?['instagram']:['instagram','meta'];const guards=await Promise.all(names.map(name=>tx.get(ref.collection('integration_guards').doc(name))));
  if(workspace?.ownerUid!==user.uid)throw new ApiError(403,'Akses workspace telah berubah.');
  const records=raw.docs.filter(doc=>!instagramOnly||doc.data().channel==='instagram');
  if(records.length*2+grants.docs.length+(pages?.docs.length||0)+names.length>490)throw new ApiError(409,'Terlalu banyak akun. Putuskan satu per satu melalui Akun sosial.');
  for(const[index,name]of names.entries()){const generation=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1).parse(guards[index].data()?.generation??0);tx.set(ref.collection('integration_guards').doc(name),{generation:generation+1});}
  for(const doc of records){tx.delete(doc.ref);tx.delete(ref.collection('connections').doc(doc.id));}
  for(const doc of grants.docs)tx.delete(doc.ref);for(const doc of pages?.docs||[])tx.delete(doc.ref);
 });
}
