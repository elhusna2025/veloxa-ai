import test from 'node:test';
import assert from 'node:assert/strict';
import { beginInstagramOAuth, finishInstagramOAuth, exchangeInstagramLogin, selectInstagramAccount, disconnectInstagram } from './instagram-oauth';
import { instagramLoginConfig, isInstagramLoginConfigured, INSTAGRAM_LOGIN_SCOPES } from './instagram-config';
import { ApiError } from './http';
import { disconnectMeta, selectMetaPage, beginMetaOAuth, finishMetaOAuth, META_SCOPES } from './meta-oauth';

const keys = ['INSTAGRAM_LOGIN_ENABLED','META_APP_ID','META_APP_SECRET','INSTAGRAM_LOGIN_CONFIG_ID','INSTAGRAM_LOGIN_REDIRECT_URI','META_REDIRECT_URI'] as const;
const appCredential='unit-app-placeholder'; const credential='unit-business-placeholder';
function configure() {
  const before=keys.map(k=>process.env[k]);
  Object.assign(process.env,{INSTAGRAM_LOGIN_ENABLED:'true',META_APP_ID:'999',META_REDIRECT_URI:'https://veloxa.example.test/api/veloxa/meta/callback',['META_APP_SECRET']:appCredential,INSTAGRAM_LOGIN_CONFIG_ID:'888',INSTAGRAM_LOGIN_REDIRECT_URI:'https://veloxa.example.test/api/veloxa/instagram/callback'});
  return()=>keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];});
}
class Collection {
  constructor(public db:Store,public path:string){}
  doc(id:string){return new Doc(this.db,this.path+'/'+id);}
  async get(){const docs=[...this.db.values.keys()].filter(k=>k.startsWith(this.path+'/')&&!k.slice(this.path.length+1).includes('/')).map(k=>new Doc(this.db,k));return{docs:await Promise.all(docs.map(async ref=>({...await ref.get(),id:ref.id,ref})))};}
}
class Doc {
  constructor(public db:Store,public path:string){}
  get id(){return this.path.split('/').at(-1)!;}
  collection(name:string){return new Collection(this.db,this.path+'/'+name);}
  async get(){const value=this.db.values.get(this.path);return{data:()=>value===undefined?undefined:structuredClone(value)};}
  async create(value:any){assert.equal(this.db.values.has(this.path),false);this.db.values.set(this.path,structuredClone(value));}
}
class Store {
  values=new Map<string,any>();
  private queue: Promise<unknown> = Promise.resolve();
  collection(path:string){return new Collection(this,path);}
  batch(){const ops:(()=>void)[]=[];return{delete:(d:Doc)=>ops.push(()=>this.values.delete(d.path)),commit:async()=>ops.forEach(f=>f())};}
  async runTransaction<T>(fn:(tx:any)=>Promise<T>):Promise<T>{const run=this.queue.then(async()=>{const ops:(()=>void)[]=[];const result=await fn({get:(ref:any)=>ref.get(),delete:(ref:Doc)=>ops.push(()=>this.values.delete(ref.path)),set:(ref:Doc,data:any)=>ops.push(()=>this.values.set(ref.path,structuredClone(data)))});assert.ok(ops.length<=500);ops.forEach(f=>f());return result;});this.queue=run.catch(()=>{});return run;}
}
function fixture(options:{scopes?:string[];appId?:string;expiresAt?:number;businessId?:string;changeOwner?:boolean;pagination?:boolean;hasFacebook?:boolean}={}){
  const db=new Store();const ref=db.collection('workspaces').doc('workspace-test');db.values.set(ref.path,{ownerUid:'owner-test'});
  if(options.hasFacebook!==false){db.values.set(ref.path+'/private_meta_connections/facebook',{channel:'facebook',accountId:'400',pageId:'400',accountName:'Page Test',handle:'400',expiresAt:0,['encryptedToken']:'unit-page-placeholder'});db.values.set(ref.path+'/connections/facebook',{connected:true,handle:'400'});}
  const calls:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));calls.push(url.pathname);assert.equal(url.hostname,'graph.facebook.com');assert.equal(init?.redirect,'error');
    if(options.changeOwner)db.values.set(ref.path,{ownerUid:'someone-else'});
    if(url.pathname.endsWith('/oauth/access_token')){
      assert.equal(init?.method,'POST');assert.ok(init?.body instanceof URLSearchParams);assert.equal(url.search,'');assert.equal(init.body.get('client_id'),'999');assert.equal(init.body.get('client_secret'),appCredential);assert.equal(init.body.get('code'),'unit-code');
      return Response.json({['access_token']:credential,expires_in:0});
    }
    if(url.pathname.endsWith('/debug_token')){assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${['999',appCredential].join('|')}`);return Response.json({data:{is_valid:true,app_id:options.appId??'999',scopes:options.scopes??[...INSTAGRAM_LOGIN_SCOPES],expires_at:options.expiresAt??0,data_access_expires_at:0}});}
    assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${credential}`);
    assert.equal(url.href.includes(credential),false);
    if(url.pathname.endsWith('/me'))return Response.json({client_business_id:options.businessId??'700'});
    assert.match(url.pathname,/me\/assigned_instagram_accounts$/);
    if(options.pagination&&!url.searchParams.has('after'))return Response.json({data:[{id:'202',username:'contoh.education'}],paging:{next:'https://evil.example.test/do-not-follow',cursors:{after:'cursor-one'}}});
    if(options.pagination){assert.equal(url.searchParams.get('after'),'cursor-one');return Response.json({data:[{id:'303',username:'second.brand'}]});}
    return Response.json({data:[{id:'202',username:'contoh.education'}]});
  };
  const authorize=async(_request:Request,workspaceId:unknown,ownerOnly?:boolean)=>{assert.equal(workspaceId,ref.id);assert.equal(ownerOnly,true);return{ref,user:{uid:'owner-test'},workspaceId:ref.id,workspace:{ownerUid:'owner-test'}};};
  const deps={database:db as never,authorize:authorize as never,fetcher,encrypt:(_value:string,workspaceId:string)=>'encrypted-for-'+workspaceId,now:()=>1000000};
  const request=new Request('https://veloxa.example.test/api',{method:'POST'});
  const callback=(state:string)=>new URL('https://veloxa.example.test/api/veloxa/instagram/callback?'+new URLSearchParams({state,code:'unit-code'}));
  return{db,ref,deps,request,callback,calls};
}
async function connect(f:ReturnType<typeof fixture>){const start=await beginInstagramOAuth(f.request,f.ref.id,f.deps);const state=new URL(start.url).searchParams.get('state')!;await finishInstagramOAuth(f.callback(state),f.deps);return state;}

test('disconnect is atomic against selection and invalidates in-flight OAuth without touching Facebook',async()=>{
  const restore=configure();try{
    for(const disconnectFirst of [true,false]){
      const f=fixture();await connect(f);
      const start=await beginInstagramOAuth(f.request,f.ref.id,f.deps);const state=new URL(start.url).searchParams.get('state')!;
      const actions=disconnectFirst
        ? [()=>disconnectInstagram(f.request,f.ref.id,f.deps),()=>selectInstagramAccount(f.request,f.ref.id,'202',f.deps)]
        : [()=>selectInstagramAccount(f.request,f.ref.id,'202',f.deps),()=>disconnectInstagram(f.request,f.ref.id,f.deps)];
      const results=await Promise.allSettled(actions.map(action=>action()));
      assert.equal(results[disconnectFirst?0:1].status,'fulfilled');
      if(disconnectFirst)assert.equal(results[1].status,'rejected');
      assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);
      assert.equal(f.db.values.has(f.ref.path+'/instagram_authorizations/current'),false);
      await assert.rejects(finishInstagramOAuth(f.callback(state),f.deps));
      assert.equal(f.db.values.has(f.ref.path+'/instagram_authorizations/current'),false);
      assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/facebook'),true);
      // A genuinely new login after disconnect can still connect.
      await connect(f);await selectInstagramAccount(f.request,f.ref.id,'202',f.deps);
      assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),true);
    }
  }finally{restore();}
});
test('one grant containing 500 accounts can be disconnected without overflowing the write limit',async()=>{
  const restore=configure();try{
    const f=fixture();await connect(f);
    const grant=f.db.values.get(f.ref.path+'/instagram_authorizations/current');
    grant.accounts=Array.from({length:500},(_,i)=>({id:String(i+1000),username:'brand.'+i}));
    f.db.values.set(f.ref.path+'/instagram_authorizations/current',grant);
    await selectInstagramAccount(f.request,f.ref.id,'1499',f.deps);
    await disconnectInstagram(f.request,f.ref.id,f.deps);
    assert.equal(f.db.values.has(f.ref.path+'/instagram_authorizations/current'),false);
    assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);
  }finally{restore();}
});
test('disconnecting only Instagram preserves the existing Facebook Page authorization',async()=>{
 const restore=configure();try{
  const f=fixture();await connect(f);await selectInstagramAccount(f.request,f.ref.id,'202',f.deps);
  f.db.values.set(f.ref.path+'/meta_authorizations/500',{pageName:'Page tetap',instagramId:'',instagramHandle:'',authorizedBy:'owner-test',expiresAt:0,['encryptedToken']:'unit-ciphertext'});
  await disconnectInstagram(f.request,f.ref.id,f.deps);
  const result=await selectMetaPage(f.request,f.ref.id,'500',f.deps);
  assert.deepEqual(result.connections.map(c=>c.channel),['facebook']);
  assert.equal(f.db.values.has(f.ref.path+'/meta_authorizations/500'),true);
  assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);
 }finally{restore();}
});
test('combined disconnect is atomic against Page selection in both transaction orderings',async()=>{
 const restore=configure();try{
  for(const disconnectFirst of [true,false]){
   const f=fixture();await connect(f);await selectInstagramAccount(f.request,f.ref.id,'202',f.deps);
   f.db.values.set(f.ref.path+'/meta_authorizations/500',{pageName:'Page baru',instagramId:'303',instagramHandle:'paired.ig',authorizedBy:'owner-test',expiresAt:0,['encryptedToken']:'unit-ciphertext'});
   const actions=disconnectFirst
    ? [()=>disconnectMeta(f.request,f.ref.id,f.deps),()=>selectMetaPage(f.request,f.ref.id,'500',f.deps)]
    : [()=>selectMetaPage(f.request,f.ref.id,'500',f.deps),()=>disconnectMeta(f.request,f.ref.id,f.deps)];
   const results=await Promise.allSettled(actions.map(action=>action()));
   assert.equal(results[disconnectFirst?0:1].status,'fulfilled');
   if(disconnectFirst)assert.equal(results[1].status,'rejected');
   for(const path of ['meta_authorizations/500','instagram_authorizations/current','private_meta_connections/instagram','private_meta_connections/facebook','connections/instagram','connections/facebook'])assert.equal(f.db.values.has(f.ref.path+'/'+path),false);
  }
 }finally{restore();}
});
test('Facebook-only Page preserves independent Unified Instagram and removes stale Page-linked Instagram atomically',async()=>{
  for(const provider of ['instagram_unified','facebook']){
    const f=fixture();const now=Date.now();
    f.db.values.set(f.ref.path+'/meta_authorizations/500',{pageName:'Page baru',instagramId:'',instagramHandle:'',authorizedBy:'owner-test',expiresAt:now+60000,['encryptedToken']:'unit-ciphertext'});
    const existing={channel:'instagram',loginProvider:provider,accountId:'202',pageId:provider==='instagram_unified'?'':'400',accountName:'Contoh',handle:'@contoh.education',expiresAt:now+60000,['encryptedToken']:'unit-ciphertext'};
    f.db.values.set(f.ref.path+'/private_meta_connections/instagram',existing);
    const result=await selectMetaPage(f.request,f.ref.id,'500',f.deps);
    assert.equal(f.db.values.get(f.ref.path+'/private_meta_connections/facebook').accountId,'500');
    assert.equal(result.connections.some(c=>c.channel==='instagram'),provider==='instagram_unified');
    if(provider==='instagram_unified')assert.deepEqual(f.db.values.get(f.ref.path+'/private_meta_connections/instagram'),existing);
    else assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);
    assert.equal(f.calls.length,0);
  }
});
test('explicitly selecting a Page with paired Instagram replaces the previous independent account',async()=>{
  const f=fixture();const now=Date.now();
  f.db.values.set(f.ref.path+'/meta_authorizations/500',{pageName:'Page baru',instagramId:'303',instagramHandle:'paired.ig',authorizedBy:'owner-test',expiresAt:now+60000,['encryptedToken']:'unit-ciphertext'});
  f.db.values.set(f.ref.path+'/private_meta_connections/instagram',{loginProvider:'instagram_unified',accountId:'202'});
  const result=await selectMetaPage(f.request,f.ref.id,'500',f.deps);
  assert.equal(f.db.values.get(f.ref.path+'/private_meta_connections/instagram').accountId,'303');
  assert.equal(result.connections.find(c=>c.channel==='instagram')?.handle,'@paired.ig');
});

test('Unified Login fails closed without an enabled configuration and a trusted HTTPS callback',()=>{
  const restore=configure();try{
    assert.equal(isInstagramLoginConfigured(),true);process.env.INSTAGRAM_LOGIN_ENABLED='false';assert.equal(isInstagramLoginConfigured(),false);assert.throws(instagramLoginConfig);process.env.INSTAGRAM_LOGIN_ENABLED='true';
    for(const value of ['http://veloxa.example.test/api/veloxa/instagram/callback','https://veloxa.example.test/api/veloxa/meta/callback','https://veloxa.example.test/api/veloxa/instagram/callback?next=evil']){process.env.INSTAGRAM_LOGIN_REDIRECT_URI=value;assert.throws(instagramLoginConfig);}
  }finally{restore();}
});
test('Instagram-only Unified OAuth presents both login options, binds one-time state to configuration, and connects only an explicitly selected authorized account',async()=>{
  const restore=configure();try{
    const f=fixture();const start=await beginInstagramOAuth(f.request,f.ref.id,f.deps);const url=new URL(start.url);const state=url.searchParams.get('state')!;
    assert.equal(url.origin,'https://www.facebook.com');assert.equal(url.searchParams.get('prompt'),'login');assert.equal(url.searchParams.get('config_id'),'888');assert.equal(url.searchParams.has('scope'),false);assert.equal(state.length,43);assert.equal([...f.db.values.keys()].some(k=>k.includes(state)),false);
    await finishInstagramOAuth(f.callback(state),f.deps);
    assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);
    const authorized=f.db.values.get(f.ref.path+'/instagram_authorizations/current');assert.equal(authorized.clientBusinessId,'700');assert.equal(authorized.configId,'888');assert.equal(authorized.encryptedToken,'encrypted-for-workspace-test');
    await assert.rejects(selectInstagramAccount(f.request,f.ref.id,'999',f.deps));
    const result=await selectInstagramAccount(f.request,f.ref.id,'202',f.deps);const connection=f.db.values.get(f.ref.path+'/private_meta_connections/instagram');
    assert.equal(connection.loginProvider,'instagram_unified');assert.equal(connection.pageId,'');assert.equal(connection.accountId,'202');assert.equal(connection.expiresAt,0);assert.equal(connection.clientBusinessId,'700');assert.equal(connection.configId,'888');
    assert.equal(result.connections.find(c=>c.channel==='instagram')?.handle,'@contoh.education');assert.equal(f.db.values.get(f.ref.path+'/private_meta_connections/facebook').accountId,'400');
    const metadata=JSON.stringify(f.db.values.get(f.ref.path+'/connections/instagram'));assert.equal(metadata.includes(credential),false);assert.equal(metadata.includes('encrypted-for-'),false);
    const calls=f.calls.length;await assert.rejects(finishInstagramOAuth(f.callback(state),f.deps));assert.equal(f.calls.length,calls);
    await disconnectInstagram(f.request,f.ref.id,f.deps);assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);assert.equal(f.db.values.has(f.ref.path+'/instagram_authorizations/current'),false);assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/facebook'),true);
  }finally{restore();}
});
test('a repeated Unified grant clears a revoked selected account while leaving Facebook and separate Page-linked Instagram intact',async()=>{
  const restore=configure();try{
    for(const provider of ['instagram_unified','facebook']){
      const f=fixture();const active={channel:'instagram',loginProvider:provider,accountId:'999',pageId:provider==='facebook'?'400':'',accountName:'Revoked old account',handle:'@old.account',expiresAt:0,['encryptedToken']:'unit-old-placeholder'};
      f.db.values.set(f.ref.path+'/private_meta_connections/instagram',active);f.db.values.set(f.ref.path+'/connections/instagram',{channel:'instagram',connected:true,handle:'@old.account'});
      f.db.values.set(f.ref.path+'/instagram_authorizations/current',{accounts:[{id:'999',username:'old.account'}],authorizedBy:'owner-test',generation:0});
      await connect(f);
      assert.equal(f.db.values.get(f.ref.path+'/instagram_authorizations/current').accounts.some((a:any)=>a.id==='999'),false);
      assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),provider==='facebook');
      assert.equal(f.db.values.has(f.ref.path+'/connections/instagram'),provider==='facebook');
      assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/facebook'),true);
      assert.equal(f.db.values.has(f.ref.path+'/instagram_authorizations/current'),true);
    }
  }finally{restore();}
});
test('legacy Meta disconnect clears the Unified grant and invalidates pending Instagram OAuth',async()=>{
  const restore=configure();try{
    const f=fixture();await connect(f);await selectInstagramAccount(f.request,f.ref.id,'202',f.deps);
    const start=await beginInstagramOAuth(f.request,f.ref.id,f.deps);const state=new URL(start.url).searchParams.get('state')!;
    await disconnectMeta(f.request,f.ref.id,{database:f.db as never,authorize:f.deps.authorize as never});
    assert.equal(f.db.values.get(f.ref.path+'/integration_guards/instagram').generation,1);
    // Global disconnect atomically removed the Page grant; selecting it must fail.
    await assert.rejects(selectMetaPage(f.request,f.ref.id,'400',{database:f.db as never,authorize:f.deps.authorize as never}));
    assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);
    assert.equal(f.db.values.has(f.ref.path+'/instagram_authorizations/current'),false);
    assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);
    assert.equal(f.db.values.has(f.ref.path+'/connections/instagram'),false);
    assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/facebook'),false);
    await assert.rejects(finishInstagramOAuth(f.callback(state),f.deps));
    assert.equal(f.db.values.has(f.ref.path+'/instagram_authorizations/current'),false);
  }finally{restore();}
});
test('Instagram connection works without any Facebook Page and paginates only fixed Meta endpoints',async()=>{
  const restore=configure();try{
    const f=fixture({hasFacebook:false,pagination:true});await connect(f);assert.equal(f.db.values.get(f.ref.path+'/instagram_authorizations/current').accounts.some((a:any)=>a.id==='303'),true);
    const result=await selectInstagramAccount(f.request,f.ref.id,'303',f.deps);assert.deepEqual(result.connections.map(c=>c.channel),['instagram']);assert.equal(result.connections[0].handle,'@second.brand');
    assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/facebook'),false);
  }finally{restore();}
});
test('expired, cancelled, wrong-origin, changed-configuration and owner-changed callbacks cannot authorize Instagram accounts',async()=>{
  const restore=configure();try{
    for(const mode of ['expired','cancelled','wrong-origin','config','owner-before','owner-during']){
      const f=fixture({changeOwner:mode==='owner-during'});const start=await beginInstagramOAuth(f.request,f.ref.id,f.deps);const state=new URL(start.url).searchParams.get('state')!;const callback=f.callback(state);
      if(mode==='expired')f.deps.now=()=>2000000;if(mode==='cancelled')callback.searchParams.set('error','access_denied');if(mode==='wrong-origin')callback.hostname='evil.example.test';if(mode==='config')process.env.INSTAGRAM_LOGIN_CONFIG_ID='777';if(mode==='owner-before')f.db.values.set(f.ref.path,{ownerUid:'another-owner'});
      await assert.rejects(finishInstagramOAuth(callback,f.deps));assert.equal(f.db.values.has(f.ref.path+'/instagram_authorizations/current'),false);
      if(mode!=='owner-during')assert.equal(f.calls.length,0);process.env.INSTAGRAM_LOGIN_CONFIG_ID='888';
    }
  }finally{restore();}
});
test('missing publishing permission, wrong app, missing business identity, expired proof and provider bodies are rejected safely',async()=>{
  const restore=configure();try{
    for(const options of [{scopes:['instagram_basic','instagram_manage_messages']},{appId:'777'},{businessId:''},{expiresAt:900}]){const f=fixture(options);await assert.rejects(exchangeInstagramLogin('unit-code',f.deps.fetcher,f.deps.now),(error:unknown)=>error instanceof ApiError&&error.code==='instagram_login_failed'&&!error.message.includes(credential));}
    await assert.rejects(exchangeInstagramLogin('unit-code',async()=>{throw new Error(appCredential);}),(error:unknown)=>error instanceof ApiError&&!error.message.includes(appCredential));
  }finally{restore();}
});

test('legacy Meta OAuth cannot authorize after disconnect before or during provider verification',async()=>{
 const restore=configure();try{
  for(const during of [false,true]){
   const f=fixture();const started=await beginMetaOAuth(f.request,f.ref.id,f.deps);
   const state=new URL(started.url).searchParams.get('state')!;
   const callback=new URL('https://veloxa.example.test/api/veloxa/meta/callback?'+new URLSearchParams({state,code:'legacy-code'}));
   let calls=0;
   const fetcher:typeof fetch=async(input,init)=>{
    calls++;const u=new URL(String(input));assert.equal(u.hostname,'graph.facebook.com');
    if(during&&calls===1)await disconnectMeta(f.request,f.ref.id,f.deps);
    if(u.pathname.endsWith('/oauth/access_token')){assert.equal(init?.method,'POST');assert.equal(u.search,'');return Response.json({['access_token']:credential,expires_in:3600});}
    if(u.pathname.endsWith('/debug_token'))return Response.json({data:{is_valid:true,app_id:'999',expires_at:Math.floor(Date.now()/1000)+3600,data_access_expires_at:0}});
    if(u.pathname.endsWith('/me/permissions'))return Response.json({data:META_SCOPES.map(permission=>({permission,status:'granted'}))});
    if(u.pathname.endsWith('/me/accounts'))return Response.json({data:[{id:'500',name:'Page Contoh',['access_token']:credential,tasks:['CREATE_CONTENT']}]});
    throw new Error('Unexpected test endpoint');
   };
   if(!during)await disconnectMeta(f.request,f.ref.id,f.deps);
   await assert.rejects(finishMetaOAuth(callback,{...f.deps,fetcher}));
   assert.equal(f.db.values.has(f.ref.path+'/meta_authorizations/500'),false);
   assert.equal(f.db.values.has(f.ref.path+'/private_meta_connections/instagram'),false);
   if(!during)assert.equal(calls,0);else assert.ok(calls>0);
  }
 }finally{restore();}
});
test('fresh Meta OAuth after disconnect stores a selectable current-generation Page grant',async()=>{
 const restore=configure();try{
  const f=fixture();await disconnectMeta(f.request,f.ref.id,f.deps);
  const start=await beginMetaOAuth(f.request,f.ref.id,f.deps);const state=new URL(start.url).searchParams.get('state')!;
  const fetcher:typeof fetch=async(input)=>{
   const u=new URL(String(input));
   if(u.pathname.endsWith('/oauth/access_token'))return Response.json({['access_token']:credential,expires_in:3600});
   if(u.pathname.endsWith('/debug_token'))return Response.json({data:{is_valid:true,app_id:'999',expires_at:Math.floor(Date.now()/1000)+3600,data_access_expires_at:0}});
   if(u.pathname.endsWith('/me/permissions'))return Response.json({data:META_SCOPES.map(permission=>({permission,status:'granted'}))});
   return Response.json({data:[{id:'500',name:'Page Contoh',['access_token']:credential,tasks:['CREATE_CONTENT']}]});
  };
  await finishMetaOAuth(new URL('https://veloxa.example.test/api/veloxa/meta/callback/?'+new URLSearchParams({state,code:'legacy-code'})),{...f.deps,fetcher});
  assert.equal(f.db.values.get(f.ref.path+'/meta_authorizations/500').metaGeneration,1);
  const result=await selectMetaPage(f.request,f.ref.id,'500',f.deps);assert.equal(result.connections[0].channel,'facebook');
 }finally{restore();}
});

test('Instagram callback succeeds after Next trailing-slash normalization',async()=>{
 const restore=configure();try{
  const f=fixture();const start=await beginInstagramOAuth(f.request,f.ref.id,f.deps);
  const url=new URL(start.url);assert.equal(url.searchParams.get('override_default_response_type'),'true');
  const callback=f.callback(url.searchParams.get('state')!);callback.pathname+='/';
  await finishInstagramOAuth(callback,f.deps);
  const result=await selectInstagramAccount(f.request,f.ref.id,'202',f.deps);
  assert.equal(result.connections.find(c=>c.channel==='instagram')?.handle,'@contoh.education');
 }finally{restore();}
});
