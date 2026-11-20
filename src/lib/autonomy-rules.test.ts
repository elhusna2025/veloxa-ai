import test from 'node:test';import assert from 'node:assert/strict';
import{autonomyConfigSchema,autonomyContentInput,nextAutonomySlot,nextConfiguredAutonomySlot,validateAutonomySource,type AutoContentConfig}from'./autonomy-rules';import{blankBusinessProfile}from'./business-context';
const config:AutoContentConfig={connectionIds:['instagram_1'],days:['Sen','Sel','Rab','Kam','Jum','Sab','Min'],timesWib:['08:00','19:00'],sourceMode:'offerings',offeringIds:['erp','pos'],topics:[],intent:'education',formats:['single_post','carousel','short_video'],referenceAssetIds:[],referenceRoles:{},referenceInstruction:'',directions:'Bahasa sederhana'};
const brand={...blankBusinessProfile('ws','primary','Berez ERP'),offerings:[{id:'erp',title:'ERP',highlight:'Laporan bisnis',priceLabel:'',category:'service' as const},{id:'pos',title:'Kasir',highlight:'Transaksi',priceLabel:'',category:'service' as const}]};
test('five daily WIB slots keep the format rotation across midnight and a month boundary', () => {
 const schedule = autonomyConfigSchema.parse({ ...config, timesWib: ['07:00', '12:00', '15:00', '18:00', '21:00'] });
 let after = Date.parse('2026-11-30T06:59:00+07:00');
 const slots = Array.from({ length: 6 }, (_, sequence) => {
  const at = nextConfiguredAutonomySlot(schedule, after);
  assert.notEqual(at, null);
  after = at!;
  return { at: new Date(at!).toISOString(), format: autonomyContentInput(schedule, brand, sequence).format };
 });
 assert.deepEqual(slots, [
  { at: '2026-11-30T00:00:00.000Z', format: 'single_post' },
  { at: '2026-11-30T05:00:00.000Z', format: 'carousel' },
  { at: '2026-11-30T08:00:00.000Z', format: 'short_video' },
  { at: '2026-11-30T11:00:00.000Z', format: 'single_post' },
  { at: '2026-11-30T14:00:00.000Z', format: 'carousel' },
  { at: '2026-12-01T00:00:00.000Z', format: 'short_video' },
 ]);
});
test('five-slot schedules retain unique times, the minimum gap and a bounded daily count', () => {
 const timesWib = ['07:00', '12:00', '15:00', '18:00', '21:00'];
 assert.equal(autonomyConfigSchema.safeParse({ ...config, timesWib }).success, true);
 for (const invalid of [
  [...timesWib, '23:00'],
  ['07:00', '07:00', '15:00', '18:00', '21:00'],
  ['07:00', '07:14', '15:00', '18:00', '21:00'],
 ]) assert.equal(autonomyConfigSchema.safeParse({ ...config, timesWib: invalid }).success, false);
 assert.equal(autonomyConfigSchema.safeParse({
  ...config, timesWib: ['07:00', '07:15', '15:00', '18:00', '21:00'],
 }).success, true);
});
test('an end date includes its last WIB slot and excludes the following week',()=>{
 const schedule=autonomyConfigSchema.parse({...config,days:['Kam'],timesWib:['12:00','13:00'],endsOnWib:'2026-11-12'});
 const noon=Date.parse('2026-11-12T05:00:00Z');
 const last=Date.parse('2026-11-12T06:00:00Z');
 assert.equal(nextConfiguredAutonomySlot(schedule,noon-1),noon);
 assert.equal(nextConfiguredAutonomySlot(schedule,noon),last);
 assert.equal(nextConfiguredAutonomySlot(schedule,last),null);
 assert.equal(nextConfiguredAutonomySlot({...schedule,endsOnWib:undefined},last),Date.parse('2026-11-19T05:00:00Z'));
 assert.equal(autonomyConfigSchema.safeParse({...schedule,endsOnWib:'2026-02-30'}).success,false);
});
test('WIB clock is exclusive, crosses days/months and never depends on browser timezone',()=>{assert.equal(new Date(nextAutonomySlot(config,Date.parse('2026-11-11T00:59:00Z'))).toISOString(),'2026-11-11T01:00:00.000Z');assert.equal(new Date(nextAutonomySlot(config,Date.parse('2026-11-11T01:00:00Z'))).toISOString(),'2026-11-11T12:00:00.000Z');assert.equal(new Date(nextAutonomySlot({...config,days:['Sen']},Date.parse('2026-11-30T13:00:00Z'))).toISOString(),'2026-12-07T01:00:00.000Z');assert.throws(()=>autonomyConfigSchema.parse({...config,timesWib:['08:00','08:05']}));});
test('formats and selected products rotate deterministically; manual topics, DNA context and references remain explicit',()=>{const items=Array.from({length:6},(_,sequence)=>autonomyContentInput(config,brand,sequence,['Judul sebelumnya']));assert.deepEqual(items.map(item=>item.format),['single_post','carousel','short_video','single_post','carousel','short_video']);assert.deepEqual(items.map(item=>item.offeringIds),[['erp'],['pos'],['erp'],['pos'],['erp'],['pos']]);assert.ok(items.every(item=>item.topic.includes('Judul sebelumnya')&&item.topic.includes('Bahasa sederhana')));const topic=autonomyContentInput({...config,sourceMode:'topics',topics:['Arus kas','Stok'],intent:'promotion'},brand,3);assert.match(topic.topic,/Stok/);assert.match(topic.topic,/Promosi/);assert.equal(topic.sourceMode,'manual');assert.throws(()=>validateAutonomySource({...config,offeringIds:['foreign']},brand));assert.throws(()=>validateAutonomySource({...config,sourceMode:'profile'},blankBusinessProfile('ws','primary','Empty')));});
