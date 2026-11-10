import test from 'node:test';
import assert from 'node:assert/strict';
import {PRIMARY_BUSINESS,blankBusinessProfile,buildBusinessContexts,getBusiness,assertBusinessTargets,assetBusiness,draftBusiness} from './business-context';
import {makeBusinessAdPlan,businessDraftsForAccount} from './business-planning';
import type {ChannelConnectionState,ContentDraft} from './veloxa-types';
const second='b_123e4567-e89b-42d3-a456-426614174999';
const brand=blankBusinessProfile('workspace-a',PRIMARY_BUSINESS,'Berez');
const secondary=blankBusinessProfile('workspace-a',second,'Cendekia');
const catalog=()=>buildBusinessContexts('workspace-a',{brand},[{id:'primary',revision:1,connectionIds:['instagram_100','facebook_300']},{id:second,revision:1,brand:secondary,connectionIds:['instagram_200']}]);
test('business profiles retain distinct DNA, offerings and identity; legacy data maps only primary',()=>{
 const result=catalog();assert.equal(result[0].brand,brand);assert.equal(result[1].brand,secondary);assert.equal(assetBusiness({}),PRIMARY_BUSINESS);assert.equal(draftBusiness({}),PRIMARY_BUSINESS);assert.equal(assetBusiness({businessId:second}),second);assert.deepEqual(blankBusinessProfile('workspace-a',second,'New').offerings,[]);
 assert.throws(()=>getBusiness(result,'b_00000000-0000-0000-0000-000000000000'));
 assert.throws(()=>buildBusinessContexts('wrong-workspace',{brand},[]));
});
test('business assignment enforces single owner and rejects cross-business publication targets',()=>{
 const result=catalog();assert.doesNotThrow(()=>assertBusinessTargets(result,second,['instagram_200']));assert.throws(()=>assertBusinessTargets(result,second,['instagram_100']));assert.throws(()=>assertBusinessTargets(result,'primary',['instagram_200'],true));assert.throws(()=>assertBusinessTargets(result,second,['instagram_999']));
 assert.doesNotThrow(()=>assertBusinessTargets(result,'primary',['instagram_999'],true));
 assert.throws(()=>buildBusinessContexts('workspace-a',{brand},[{id:'primary',connectionIds:['instagram_200']},{id:second,brand:secondary,connectionIds:['instagram_200']}]));
});
test('legacy primary assignment is derived from bound draft IDs, never usernames or display names',()=>{
 const drafts=[{id:'legacy',publishTargets:[{channel:'instagram',accountId:'100',accountName:'Cendekia',handle:'@other-name'}]}] as ContentDraft[];
 const result=buildBusinessContexts('workspace-a',{brand,drafts},[]);assert.deepEqual(result[0].connectionIds,['instagram_100']);
 assert.deepEqual(buildBusinessContexts('workspace-a',{brand,drafts},[{id:'primary',revision:1,connectionIds:[]}])[0].connectionIds,[]);
});
test('schedule content filters business and exact account independently',()=>{
 const drafts=[{id:'legacy',publishTargets:[{connectionId:'instagram_100'}]},{id:'education',businessId:second,publishTargets:[{connectionId:'instagram_200'}]}] as ContentDraft[];
 assert.deepEqual(businessDraftsForAccount(drafts,'primary').map(item=>item.id),['legacy']);assert.deepEqual(businessDraftsForAccount(drafts,second,'instagram_100'),[]);assert.deepEqual(businessDraftsForAccount(drafts,second,'instagram_200').map(item=>item.id),['education']);const legacy=[{id:'old-bound',publishTargets:[{channel:'instagram',accountId:'100'}]}] as ContentDraft[];assert.equal(businessDraftsForAccount(legacy,'primary','instagram_100').length,1);const malformed=[{publishTargets:[{connectionId:'invalid',channel:'instagram',accountId:'100'}]}] as ContentDraft[];assert.deepEqual(buildBusinessContexts('workspace-a',{brand,drafts:malformed},[])[0].connectionIds,[]);
});
test('ad plans are paused and bind correct business and exact accounts; foreign content and budgets are rejected',()=>{
 const business=catalog()[1];const accounts=[{connectionId:'instagram_200',accountId:'200',channel:'instagram',connected:true,accountName:'Cendekia',handle:'@cendekia'}] as ChannelConnectionState[];
 const input={connectionIds:['instagram_200'],title:'Persiapan SNBT',daily:50000,duration:7,dailyCap:100000,monthlyCap:3000000,objective:'INSTAGRAM_PROFILE_VISITS' as const};
 const plan=makeBusinessAdPlan(business,accounts,input);assert.equal(plan.businessId,second);assert.equal(plan.status,'draft_paused');assert.equal(plan.destinationAccounts[0].handle,'@cendekia');assert.equal(plan.budget.spentToDateIdr,0);
 assert.throws(()=>makeBusinessAdPlan(business,accounts,{...input,connectionIds:['instagram_100']}));assert.throws(()=>makeBusinessAdPlan(business,accounts,{...input,source:{businessId:'primary'} as ContentDraft}));assert.throws(()=>makeBusinessAdPlan(business,accounts,{...input,monthlyCap:1000}));
});
