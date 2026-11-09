import test from 'node:test';
import assert from 'node:assert/strict';
import { profileFingerprint } from './profile-fingerprint';
import { buildVisualBusinessContext } from './content-business-context';
import { normalizeBrandProfile } from './veloxa-brand-profile';
import { buildWorkspaceSnapshotSyncPayload, buildRealInitialWorkspaceSnapshot } from './veloxa-firestore-repo';
import { SnapshotConflictError } from './workspace-snapshot-revision';
import { BRAND_PRESETS, runAutonomousQualityRepairLoop } from './veloxa-engine';
import { forbiddenContentMatches } from './content-policy';

test('fingerprint covers all saved profile data and is stable across object key order',async()=>{
 const brand=structuredClone(BRAND_PRESETS.custom);const reordered=Object.fromEntries(Object.entries(brand).reverse()) as typeof brand;
 assert.equal(await profileFingerprint(brand),await profileFingerprint(reordered));
 for(const patch of [{brandTone:'Profesional'},{websiteUrl:'https://business.example.test'},{additionalColorHexes:['#123456']},{offerings:[...brand.offerings,{id:'new',title:'Kelima',category:'service' as const,highlight:'Baru',priceLabel:''}]}])assert.notEqual(await profileFingerprint(brand),await profileFingerprint({...brand,...patch}));
});
test('payload CAS rejects stale or unverified existing state and preserves identical snapshot revision',()=>{
 const snapshot=buildRealInitialWorkspaceSnapshot({workspaceId:'ws_cas',businessName:'Usaha',city:'',category:'custom',planId:'free_trial'});
 const params={workspaceId:'ws_cas',ownerUid:'owner',memberUids:['owner'],snapshot,serialized:JSON.stringify(snapshot)};
 assert.equal(buildWorkspaceSnapshotSyncPayload({...params,existingData:null}).snapshotRevision,1);
 assert.throws(()=>buildWorkspaceSnapshotSyncPayload({...params,existingData:null,expectedRevision:4}),SnapshotConflictError);
 const existing={ownerUid:'owner',snapshotJson:JSON.stringify(snapshot),snapshotRevision:4};
 for(const expectedRevision of [undefined,0,3,5])assert.throws(()=>buildWorkspaceSnapshotSyncPayload({...params,existingData:existing,expectedRevision}),SnapshotConflictError);
 assert.equal(buildWorkspaceSnapshotSyncPayload({...params,existingData:existing,expectedRevision:4}).snapshotRevision,4);
 const edited={...snapshot,brand:{...snapshot.brand,businessName:'Profil baru'}};
 assert.equal(buildWorkspaceSnapshotSyncPayload({...params,snapshot:edited,serialized:JSON.stringify(edited),existingData:existing,expectedRevision:4}).snapshotRevision,5);
 assert.equal(existing.snapshotRevision,4);
});
test('complete description and every product detail survive structured visual context; oversize fails explicitly',()=>{
 const brand={...BRAND_PRESETS.custom,businessDescription:'D'.repeat(2000),city:'Seluruh Indonesia (online)',brandTone:'Profesional',websiteUrl:'https://business.example.test',offerings:Array.from({length:8},(_,index)=>({id:`p${index}`,title:`Produk ${index}`,highlight:`MANFAAT_${index}_`+'x'.repeat(300),priceLabel:`Harga ${index}`,category:'service' as const}))};
 const context=buildVisualBusinessContext(brand,'Produk ketujuh');assert.equal(context.description,brand.businessDescription);assert.deepEqual(context.offerings,brand.offerings);assert.equal(context.websiteUrl,brand.websiteUrl);assert.equal(context.brandTone,brand.brandTone);assert.equal(context.serviceArea,brand.city);
 const huge={...brand,offerings:brand.offerings.map(item=>({...item,highlight:'x'.repeat(4000)}))};assert.throws(()=>buildVisualBusinessContext(huge,'Audit'),/Tidak ada produk yang dipotong otomatis/);assert.throws(()=>normalizeBrandProfile(huge),/terlalu panjang/);
});
test('natural short hooks stay verbatim and all text surfaces respect prohibited literal words',()=>{
 const brand={...BRAND_PRESETS.custom,businessName:'Berez ERP',brandTone:'Profesional',forbiddenWords:['termurah','[khusus]']};
 const result=runAutonomousQualityRepairLoop({title:'Stok rapi',hook:'Stok lebih rapi',caption:'Berez ERP membantu tim mencatat stok.',brand});assert.equal(result.repairedHook,'Stok lebih rapi');assert.equal(result.review.passed,true);
 const draft={title:'Stok rapi',hook:result.repairedHook,caption:result.repairedCaption,hashtags:['#Termurah'],slides:[],videoScenes:[]};assert.deepEqual(forbiddenContentMatches(draft,brand.forbiddenWords),['termurah']);assert.deepEqual(forbiddenContentMatches({...draft,hashtags:[],slides:[{slideNumber:1,headline:'[KHUSUS]',body:'Isi',visualDirection:'Adegan',badgeText:'1/1'}]},brand.forbiddenWords),['[khusus]']);
});
