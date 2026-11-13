import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readMetaImage,collectSocialEvidence} from './brand-social-sources';
import {BRAND_ANALYSIS_POST_LIMIT,type BrandOfferingSuggestion} from '../brand-analysis';
import {MetaRequestError} from './meta-graph';
import {profileAnalysisSchema,validateAnalysisOutput} from './brand-analysis-agent';
const account={connectionId:'instagram_100',storageId:'instagram_100',channel:'instagram' as const,accountId:'100',pageId:'100',accountName:'Berez',handle:'@berezerp',encryptedToken:'private',expiresAt:0,loginProvider:'instagram' as const};
test('Meta images reject arbitrary hosts, credentials, HTTP and oversize bodies without forwarding tokens',async()=>{let calls=0;const image=await sharp({create:{width:30,height:20,channels:3,background:'blue'}}).jpeg().toBuffer();const fetcher=(async(url:any,init:any)=>{calls++;assert.equal(new URL(url).hostname,'a.cdninstagram.com');assert.equal(init.redirect,'error');assert.equal(init.headers,undefined);return new Response(new Uint8Array(image),{headers:{'Content-Type':'image/jpeg'}});}) as typeof fetch;for(const raw of ['http://a.cdninstagram.com/a','https://127.0.0.1/a','https://a.cdninstagram.com.evil.test/a','https://user:pass@a.cdninstagram.com/a','https://a.cdninstagram.com:3000/a'])await assert.rejects(readMetaImage(raw,fetcher));assert.equal(calls,0);assert.ok((await readMetaImage('https://a.cdninstagram.com/a',fetcher)).length>0);await assert.rejects(readMetaImage('https://a.cdninstagram.com/a',(async()=>new Response(new Uint8Array(5*1024*1024+1),{headers:{'Content-Type':'image/jpeg'}}))as typeof fetch));});
test('social evidence is bounded, partial permission failures are visible, provider preserved, private URLs absent',async()=>{let count=0;const evidence=await collectSocialEvidence([account],()=> 'token',{graph:(async(path:string,token:string,method:string,values:any,_fetch:any,provider:string)=>{assert.equal(token,'token');assert.equal(method,'GET');assert.equal(provider,'instagram');assert.equal(values.limit,path.includes('/')?String(BRAND_ANALYSIS_POST_LIMIT):undefined);count++;if(path==='100')throw new MetaRequestError('unsupported',false,100);return{data:Array.from({length:20},(_,i)=>({caption:'Produk ERP '+i+' x'.repeat(1000)+' Detail penutupan',media_url:'https://a.fbcdn.net/image?secret=private'}))};})as never,image:async()=>Buffer.from('image')});assert.equal(count,3);assert.equal(evidence.sources.length,BRAND_ANALYSIS_POST_LIMIT);assert.ok(evidence.sources.every(source=>source.text.endsWith('Detail penutupan')));assert.ok(evidence.warnings.length);assert.ok(evidence.images.length<=6);assert.equal(JSON.stringify(evidence.sources).includes('secret='),false);});
test('visual sampling covers posts from both accounts before sampling more recent posts',async()=>{
 const other={...account,connectionId:'instagram_200',accountId:'200'};
 const evidence=await collectSocialEvidence([account,other],()=> 'token',{
  graph:(async(path:string)=>path.includes('/')?{data:Array.from({length:8},(_,i)=>({media_url:'https://a.fbcdn.net/'+path+'/'+i}))}:{username:'business',profile_picture_url:'https://a.fbcdn.net/'+path}) as never,
  image:async()=>Buffer.from('image'),
 });
 assert.deepEqual(evidence.images.map(image=>image.sourceId),[
  'instagram_100_post_0','instagram_100_post_1','instagram_100_profile','instagram_200_post_0','instagram_200_post_1','instagram_200_profile',
 ]);
});

test('AI uses attributable product details and skips unsupported items without losing the valid catalog',()=>{
 const raw:any=Object.fromEntries(Object.keys(profileAnalysisSchema.shape).map(key=>[key,key==='logoSourceId'?null:{value:null,sourceIds:[],basis:'observed',reason:''}]));
 raw.city={value:'Indonesia',sourceIds:['p'],basis:'inferred',reason:'Guess',evidenceQuote:''};
 raw.websiteUrl={value:'https://invented.test/',sourceIds:['p'],basis:'observed',reason:'Guess'};
 const offering={title:'ERP',overview:'Membantu mengelola persediaan.',features:['Stok per cabang','Mutasi antar gudang'],audience:'Pengelola gudang',benefit:'Pantau pergerakan persediaan.',useCase:null,sourceIds:['p'],evidenceQuote:'Stok per cabang',category:'service'};
 raw.offerings={value:[offering,{...offering,title:'Tanpa bukti',sourceIds:['foreign']},{...offering,title:'Kutipan keliru',evidenceQuote:'Tidak pernah disebut'},{...offering,title:'Klaim visual tanpa foto',evidenceQuote:null}],sourceIds:['p'],basis:'observed',reason:'Caption'};
 const evidence={sources:[{id:'p',kind:'post' as const,label:'Postingan',text:'ERP mendukung stok per cabang dan mutasi antar gudang.'}],images:[],websites:[],warnings:[]};
 const value=validateAnalysisOutput(raw,evidence);
 assert.deepEqual(value.map(item=>item.key),['offerings']);
 const items=value[0].value as BrandOfferingSuggestion[];
 assert.equal(items.length,1);
 assert.deepEqual(items[0].sourceIds,['p']);
 assert.equal(items[0].priceLabel,'');
 assert.match(items[0].highlight,/Fitur dan cakupan: Stok per cabang · Mutasi antar gudang/);
 assert.match(items[0].highlight,/Untuk: Pengelola gudang/);
 assert.doesNotMatch(items[0].highlight,/Contoh penggunaan/);
 const withPhoto=validateAnalysisOutput(raw,{...evidence,images:[{sourceId:'p',avatar:false,bytes:Buffer.from('photo')}]});
 assert.equal((withPhoto[0].value as BrandOfferingSuggestion[]).length,2);
 raw.offerings.sourceIds=['foreign'];
 assert.throws(()=>validateAnalysisOutput(raw,evidence),/sumber/);
 raw.offerings.sourceIds=['p'];
 raw.offerings.value[0].priceLabel='Rp1';
 assert.throws(()=>validateAnalysisOutput(raw,evidence));
});

test('service area requires an exact explicit service quote; office location never becomes coverage',()=>{
 const raw:any=Object.fromEntries(Object.keys(profileAnalysisSchema.shape).map(key=>[key,key==='logoSourceId'?null:{value:null,sourceIds:[],basis:'observed',reason:''}]));const evidence={sources:[{id:'p',kind:'post' as const,label:'Postingan',text:'Kantor Berez di Bandung. Melayani seluruh Indonesia secara online.'}],images:[],websites:[],warnings:[]};
 raw.city={value:'Bandung',sourceIds:['p'],basis:'observed',reason:'Lokasi kantor',evidenceQuote:'Kantor Berez di Bandung.'};assert.equal(validateAnalysisOutput(raw,evidence).length,0);
 raw.city={value:'Seluruh Indonesia (online)',sourceIds:['p'],basis:'observed',reason:'Cakupan disebutkan',evidenceQuote:'Melayani seluruh Indonesia secara online.'};assert.equal(validateAnalysisOutput(raw,evidence)[0].key,'city');
 raw.city.evidenceQuote='Melayani seluruh Indonesia dan luar negeri';assert.equal(validateAnalysisOutput(raw,evidence).length,0);
 raw.city={value:'Bandung',sourceIds:['p'],basis:'observed',reason:'Office confused with coverage',evidenceQuote:evidence.sources[0].text};assert.equal(validateAnalysisOutput(raw,evidence).length,0);
});
