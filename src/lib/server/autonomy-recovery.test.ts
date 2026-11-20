import test from 'node:test';
import assert from 'node:assert/strict';
import {canRetryGeneration,recoveryTime} from './autonomy-recovery';
import {GenerationStageError} from './content-generation-stream';
import {ApiError} from './http';

test('known-unsent repair keeps retrying with a capped delay past the next slot and 30 minutes',()=>{
 const slot=1_000_000,now=slot+2*60*60_000;
 for(const kind of ['generation','reels_artwork'] as const){
  assert.equal(recoveryTime(kind,1,slot,now,slot+60_000),now+120_000);
  assert.equal(recoveryTime(kind,6,slot,now,slot+60_000),now+15*60_000);
  assert.equal(recoveryTime(kind,100_000,slot,now,null),now+15*60_000);
 }
 assert.equal(recoveryTime('publication',1,slot,now,null),now+2*60_000);
 assert.equal(recoveryTime('publication',3,slot,slot,null),slot+10*60_000);
 assert.equal(recoveryTime('publication',100_000,slot,now,slot),now+15*60_000);
 for(const attempts of [0,-1,1.5,NaN,Infinity])assert.equal(recoveryTime('generation',attempts,slot,now,null),null);
});

test('repair only retries known generation stages and never uncertain script creation or saving',()=>{
 for(const code of ['visual_review_incomplete','scheduled_artwork_rejected','reels_photo_layout_unreadable','scheduled_script_rejected','content_agent_pending']){
  assert.equal(canRetryGeneration(new GenerationStageError(new ApiError(code.endsWith('_rejected')||code==='reels_photo_layout_unreadable'?422:503,'retry',code),'compositing')),true);
 }
 for(const stage of ['saving','validation'] as const){
  assert.equal(canRetryGeneration(new GenerationStageError(new ApiError(503,'unknown'),stage)),false);
 }
 for(const code of ['content_agent_creation_uncertain','content_agent_failed','content_agent_cancelled','content_agent_waiting','content_policy_violation']){
  assert.equal(canRetryGeneration(new GenerationStageError(new ApiError(503,'stop',code),'script')),false);
 }
 assert.equal(canRetryGeneration(new ApiError(503,'unscoped failure')),false);
});

test('continuations and known quality repairs do not inherit long provider-outage backoff',()=>{
 const slot=1_000_000,now=slot+2*60*60_000;
 assert.equal(recoveryTime('artwork_repair',1,slot,now,null),now+60_000);
 for(const attempts of [2,6,100_000]){
  assert.equal(recoveryTime('continuation',attempts,slot,now,null),now+1_000);
  assert.equal(recoveryTime('artwork_repair',attempts,slot,now,null),now+120_000);
 }
 assert.equal(recoveryTime('generation',100_000,slot,now,null),now+15*60_000);
 assert.equal(recoveryTime('publication',100_000,slot,now,null),now+15*60_000);
});
