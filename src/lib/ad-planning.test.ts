import test from 'node:test';import assert from 'node:assert/strict';
import {validateAdStrategy,strongestObservedDraft,readAdPlanningStream} from './ad-planning';
export const strategy={objective:'WEBSITE_CONVERSIONS',summary:'Kenalkan sistem ERP.',sourceReason:'Materi sesuai produk.',audience:'Pemilik toko',location:'Indonesia',ageMin:18,ageMax:65,interests:['Pengelolaan bisnis'],dailyBudgetIdr:100000,durationDays:30,budgetReason:'Mulai dengan pengujian.',creativeAngle:'Demonstrasi produk',testingPlan:['Tinjau biaya dan hasil setelah data cukup.'],questions:['Pastikan tujuan website.']};
test('AI budgets never exceed daily/total/duration caps, and invalid demographics are rejected',()=>{
 for(const total of[25000,50000,125000,1100000])for(const daily of[25000,75000,100000])for(const days of[1,7,30]){const value=validateAdStrategy(strategy,{daily,total,days}).strategy;assert.ok(value.dailyBudgetIdr<=daily);assert.ok(value.dailyBudgetIdr*value.durationDays<=total);assert.ok(value.durationDays<=days);assert.ok(value.dailyBudgetIdr>=25000);}
 assert.throws(()=>validateAdStrategy({...strategy,ageMin:65,ageMax:18},{daily:100000,total:300000,days:7}));assert.throws(()=>validateAdStrategy(strategy,{daily:NaN,total:300000,days:7}));assert.throws(()=>validateAdStrategy({...strategy,pretendMetaId:'made-up'},{daily:100000,total:300000,days:7}));
});
test('performance selection uses only complete observed counters, zero counts are valid and missing is not zero',()=>{
 const item={connectionId:'instagram_1',observedAt:1};assert.equal(strongestObservedDraft([{...item,draftId:'missing',likes:1000,comments:null}]),undefined);
 assert.equal(strongestObservedDraft([{...item,draftId:'missing',likes:1000,comments:null},{...item,draftId:'zero',likes:0,comments:0},{...item,draftId:'real',likes:2,comments:3}]),'real');assert.equal(strongestObservedDraft([{...item,draftId:'negative',likes:-1,comments:8}]),undefined);
});
test('ad planning stream reports genuine stages and rejects disconnected/error output',async()=>{
 const stages:string[]=[];const data={id:'ad_suggestion_test',strategy};const value=await readAdPlanningStream(new Response(JSON.stringify({type:'progress',stage:'strategy'})+'\n'+JSON.stringify({type:'complete',data})+'\n'),stage=>stages.push(stage));assert.equal(value.id,data.id);assert.deepEqual(stages,['strategy']);
 await assert.rejects(readAdPlanningStream(new Response('{"type":"progress","stage":"review"}\n'),()=>{}),/terputus/);await assert.rejects(readAdPlanningStream(new Response('{"type":"error","error":"Metrik belum tersedia"}\n'),()=>{}),/Metrik/);
});
