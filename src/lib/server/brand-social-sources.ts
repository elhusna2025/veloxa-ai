import sharp from 'sharp';
import type {BrandSource} from '../brand-analysis';
import {graphRequest,MetaRequestError,getMetaLoginProvider} from './meta-graph';
import type {StoredAccount} from './social-accounts';
export interface AnalysisImage{sourceId:string;bytes:Buffer;avatar:boolean}
export interface SocialEvidence{sources:BrandSource[];images:AnalysisImage[];warnings:string[];websites:string[]}
/** These URLs originate from Meta GET responses, never from a submitted profile or user URL. */
export async function readMetaImage(raw:string,fetcher:typeof fetch=fetch):Promise<Buffer>{
 const url=new URL(raw);if(url.protocol!=='https:'||url.port||url.username||url.password||!['cdninstagram.com','fbcdn.net','fbsbx.com'].some(host=>url.hostname.endsWith('.'+host)))throw new Error('unsupported_media_host');
 const response=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok||!response.headers.get('Content-Type')?.startsWith('image/')||Number(response.headers.get('Content-Length')||0)>5*1024*1024)throw new Error('unsupported_media');
 const reader=response.body?.getReader();if(!reader)throw new Error('missing_media');const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>5*1024*1024)throw new Error('media_too_large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return sharp(Buffer.concat(chunks),{limitInputPixels:30_000_000}).rotate().resize(900,900,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:80}).toBuffer();
}
const clean=(value:unknown,limit=1800)=>typeof value==='string'?value.replace(/https?:\/\/\S+/g,match=>{try{const u=new URL(match);return u.origin+u.pathname;}catch{return '';}}).slice(0,limit):'';
function website(value:unknown):string|undefined{if(typeof value!=='string'||value.length>500)return;try{const u=new URL(value.includes('://')?value:'https://'+value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return;u.search='';u.hash='';return u.href;}catch{return;}}
/** Read only a bounded recent sample; unavailable fields become visible partial-result warnings. */
export async function collectSocialEvidence(accounts:StoredAccount[],token:(account:StoredAccount)=>string,deps:{graph?:typeof graphRequest;image?:typeof readMetaImage;progress?:()=>void}={}):Promise<SocialEvidence>{
 const evidence:SocialEvidence={sources:[],images:[],warnings:[],websites:[]};const media:{sourceId:string;url:string;avatar:boolean}[]=[];const graph=deps.graph||graphRequest;
 for(let offset=0;offset<accounts.length;offset+=3)await Promise.all(accounts.slice(offset,offset+3).map(async account=>{
  const id=account.accountId;const prefix=account.connectionId;const label=clean(account.handle||account.accountName,120);const provider=getMetaLoginProvider(account.loginProvider);const request=<T>(path:string,fields:string)=>graph<T>(path,token(account),'GET',{fields,...(path.includes('/')?{limit:'8'}:{})},fetch,provider);
  let profile:Record<string,unknown>={};let profileRead=false;
  try{profile=await request(id,account.channel==='instagram'?'id,username,name,biography,website,profile_picture_url':'id,name,about,description,website,category,picture.type(large)');profileRead=true;}
  catch(error){if(error instanceof MetaRequestError&&error.providerCode===100){try{profile=await request(id,account.channel==='instagram'?'id,username':'id,name');profileRead=true;}catch{/* Account-specific warning below. */}}evidence.warnings.push(`${label}: sebagian informasi profil tidak tersedia melalui izin Meta saat ini.`);}
  if(profileRead){const text=Object.entries(profile).filter(([key,value])=>!['picture','profile_picture_url','id'].includes(key)&&typeof value==='string').map(([key,value])=>`${key}: ${clean(value)}`).join('\n');evidence.sources.push({id:prefix+'_profile',connectionId:prefix,kind:'profile',label:`Profil ${label}`,text:text.slice(0,2400)});const address=website(profile.website);if(address)evidence.websites.push(address);
   const avatar=typeof profile.profile_picture_url==='string'?profile.profile_picture_url:(profile.picture as {data?:{url?:string}})?.data?.url;if(avatar)media.push({sourceId:prefix+'_profile',url:avatar,avatar:true});}
  try{const posts=await request<{data?:Record<string,unknown>[]}>(id+(account.channel==='instagram'?'/media':'/posts'),account.channel==='instagram'?'id,caption,media_type,media_url,thumbnail_url,timestamp':'id,message,full_picture,created_time');if(!Array.isArray(posts.data))throw new Error('invalid_posts');
   posts.data.slice(0,8).forEach((post,index)=>{const sourceId=prefix+'_post_'+index;const text=clean(post.caption||post.message);const url=account.channel==='instagram'?(post.media_type==='VIDEO'?post.thumbnail_url:post.media_url):post.full_picture;if(text||typeof url==='string'){evidence.sources.push({id:sourceId,connectionId:prefix,kind:'post',label:`Postingan ${index+1} ${label}`,text:text||'Foto postingan tanpa caption'});if(typeof url==='string')media.push({sourceId,url,avatar:false});}});
   if(!posts.data.length)evidence.warnings.push(`${label}: belum ada postingan yang dapat dianalisis.`);
  }catch{evidence.warnings.push(`${label}: postingan belum dapat dibaca. Usulan hanya memakai sumber yang tersedia.`);}
 }));
 deps.progress?.();
 // Fair sampling: at most one avatar and one post per account before filling remaining slots.
 const sorted=media.sort((a,b)=>Number(b.avatar)-Number(a.avatar));const selected=sorted.filter((item,index)=>sorted.findIndex(other=>other.sourceId===item.sourceId)===index).slice(0,6);
 for(let offset=0;offset<selected.length;offset+=2)await Promise.all(selected.slice(offset,offset+2).map(async item=>{try{evidence.images.push({sourceId:item.sourceId,avatar:item.avatar,bytes:await(deps.image||readMetaImage)(item.url)});}catch{evidence.warnings.push(`Foto pada ${evidence.sources.find(source=>source.id===item.sourceId)?.label||'akun sosial'} belum dapat dibaca.`);}}));
 evidence.sources.sort((a,b)=>a.id.localeCompare(b.id));evidence.images.sort((a,b)=>a.sourceId.localeCompare(b.sourceId));return evidence;
}
