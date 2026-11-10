import { requireWorkspace } from './auth';
import { adminDb } from './firebase';
import { ApiError } from './http';
import { getMetaLoginProvider, type MetaConnection } from './meta-graph';
import { assertNotDisconnected, connectionIdSchema, publicSocialAccount, readSocialAccounts, socialConnectionId } from './social-accounts';
import { instagramLoginConfig } from './instagram-config';
import { z } from 'zod';
type Deps={authorize?:typeof requireWorkspace;database?:ReturnType<typeof adminDb>;now?:()=>number};
const numeric=z.string().regex(/^\d{1,128}$/);
const generation=(value:unknown)=>z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1).parse(value??0);

export async function addFacebookPage(request:Request,workspaceId:unknown,pageId:unknown,deps:Deps={}) {
 const {ref,user}=await(deps.authorize||requireWorkspace)(request,workspaceId,true);const id=numeric.parse(pageId);
 return(deps.database||adminDb()).runTransaction(async tx=>{
  const workspace=(await tx.get(ref)).data();
  const authorized=(await tx.get(ref.collection('meta_authorizations').doc(id))).data();
  const existing=readSocialAccounts((await tx.get(ref.collection('private_meta_connections'))).docs);
  if(workspace?.ownerUid!==user.uid||!authorized||authorized.authorizedBy!==user.uid||(authorized.expiresAt&&authorized.expiresAt<=Date.now()))throw new ApiError(409,'Berikan izin Meta untuk Page ini terlebih dahulu.','reconnect_required');
  const additions:MetaConnection[]=[{channel:'facebook',loginProvider:'facebook',accountId:id,pageId:id,accountName:authorized.pageName,handle:id,encryptedToken:authorized.encryptedToken,expiresAt:authorized.expiresAt}];
  if(authorized.instagramId){
   const independent=existing.find(item=>item.channel==='instagram'&&item.accountId===authorized.instagramId&&getMetaLoginProvider(item.loginProvider)!=='facebook');
   if(!independent)additions.push({...additions[0],channel:'instagram',accountId:authorized.instagramId,accountName:authorized.instagramHandle,handle:'@'+authorized.instagramHandle});
  }
  for(const account of additions) assertNotDisconnected((await tx.get(ref.collection('integration_guards').doc(socialConnectionId(account.channel,account.accountId)))).data(),authorized.authorizedAt);
  for(const account of additions){const key=socialConnectionId(account.channel,account.accountId);tx.set(ref.collection('private_meta_connections').doc(key),account);tx.set(ref.collection('connections').doc(key),publicSocialAccount(account));
   const legacy=existing.find(item=>item.connectionId===key&&item.storageId===account.channel);if(legacy){tx.delete(ref.collection('private_meta_connections').doc(account.channel));tx.delete(ref.collection('connections').doc(account.channel));}}
  const updated=new Map(existing.map(item=>[item.connectionId,item as MetaConnection]));for(const item of additions)updated.set(socialConnectionId(item.channel,item.accountId),item);
  return{connections:[...updated.values()].map(publicSocialAccount)};
 });
}
export async function addInstagramAccount(request:Request,workspaceId:unknown,accountId:unknown,deps:Deps={}) {
 const {ref,user}=await(deps.authorize||requireWorkspace)(request,workspaceId,true);const id=numeric.parse(accountId);const config=instagramLoginConfig();const now=(deps.now||Date.now)();
 return(deps.database||adminDb()).runTransaction(async tx=>{
  const workspace=(await tx.get(ref)).data();const grants=await tx.get(ref.collection('instagram_authorizations'));
  const guard=(await tx.get(ref.collection('integration_guards').doc(socialConnectionId('instagram',id)))).data();
  const existing=readSocialAccounts((await tx.get(ref.collection('private_meta_connections'))).docs);
  const valid=grants.docs.map(doc=>doc.data()).filter(value=>value.authorizedBy===user.uid&&value.configId===config.configId&&(!value.expiresAt||value.expiresAt>now)&&value.accounts?.some((account:{id:string})=>account.id===id)).sort((a,b)=>(b.authorizedAt||0)-(a.authorizedAt||0));
  const value=valid[0];if(workspace?.ownerUid!==user.uid||!value)throw new ApiError(409,'Berikan izin Instagram untuk akun ini terlebih dahulu.','reconnect_required');assertNotDisconnected(guard,value.authorizedAt);
  const account=value.accounts.find((item:{id:string})=>item.id===id);
  const connection:MetaConnection={channel:'instagram',loginProvider:'instagram_unified',accountId:id,pageId:'',accountName:account.username,handle:'@'+account.username,encryptedToken:value.encryptedToken,expiresAt:value.expiresAt,clientBusinessId:value.clientBusinessId,configId:value.configId};
  const key=socialConnectionId('instagram',id);tx.set(ref.collection('private_meta_connections').doc(key),connection);tx.set(ref.collection('connections').doc(key),publicSocialAccount(connection));
  const legacy=existing.find(item=>item.connectionId===key&&item.storageId==='instagram');if(legacy){tx.delete(ref.collection('private_meta_connections').doc('instagram'));tx.delete(ref.collection('connections').doc('instagram'));}
  return{connections:[...existing.filter(item=>item.connectionId!==key),connection].map(publicSocialAccount)};
 });
}
/** A disconnect revokes only this selection. Provider-wide epoch fences pending OAuth callbacks. */
export async function disconnectSocialAccount(request:Request,workspaceId:unknown,connectionId:unknown,deps:Deps={}) {
 const {ref,user}=await(deps.authorize||requireWorkspace)(request,workspaceId,true);const key=connectionIdSchema.parse(connectionId);
 await(deps.database||adminDb()).runTransaction(async tx=>{
  const workspace=(await tx.get(ref)).data();const raw=await tx.get(ref.collection('private_meta_connections'));const accounts=readSocialAccounts(raw.docs);
  const guards=await Promise.all(['meta','instagram'].map(name=>tx.get(ref.collection('integration_guards').doc(name))));
  if(workspace?.ownerUid!==user.uid)throw new ApiError(403,'Akses workspace telah berubah.');
  const account=accounts.find(item=>item.connectionId===key);if(!account)throw new ApiError(404,'Akun tidak ditemukan di workspace ini.');
  tx.set(ref.collection('integration_guards').doc(key),{disconnectedAt:(deps.now||Date.now)()});
  for(const [index,name]of ['meta','instagram'].entries())tx.set(ref.collection('integration_guards').doc(name),{generation:generation(guards[index].data()?.generation)+1});
  tx.delete(ref.collection('private_meta_connections').doc(key));tx.delete(ref.collection('connections').doc(key));
  if(raw.docs.some(doc=>doc.id===account.channel&&doc.data().accountId===account.accountId)){tx.delete(ref.collection('private_meta_connections').doc(account.channel));tx.delete(ref.collection('connections').doc(account.channel));}
 });
}
