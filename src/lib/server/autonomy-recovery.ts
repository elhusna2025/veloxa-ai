import {GenerationStageError} from './content-generation-stream';

const minute=60_000;
const generationDelays=[2*minute,3*minute,5*minute,10*minute,15*minute];
const reelsArtworkDelays=generationDelays;
const publicationDelays=[2*minute,5*minute,10*minute,15*minute];
const continuationDelays=[1_000];
const artworkRepairDelays=[minute,2*minute];

const recoveryDelays = { generation:generationDelays, reels_artwork:reelsArtworkDelays, publication:publicationDelays, continuation:continuationDelays, artwork_repair:artworkRepairDelays };

export function recoveryTime(kind:keyof typeof recoveryDelays, attempts:number, _scheduledAt:number, now:number, _nextSlot:number|null) {
  if(!Number.isSafeInteger(attempts)||attempts<1||!Number.isFinite(now))return null;
  const delays=recoveryDelays[kind];
  // Only known-unsent work reaches recovery. Continue the same durable slot
  // until it succeeds or current authorization changes; cap the delay.
  const delay=delays[Math.min(attempts-1,delays.length-1)];
  if(delay===undefined)return null;
  const due=now+delay;
  return due;
}

export function canRetryGeneration(error:unknown) {
  if(!(error instanceof GenerationStageError))return false;
  // Saving may already have written a draft; never generate another from an uncertain write.
  if(error.stage==='saving'||error.stage==='validation')return false;
  if(['content_agent_creation_uncertain','content_agent_failed','content_agent_cancelled','content_agent_waiting','content_policy_violation'].includes(error.code))return false;
  if(error.code==='content_agent_pending')return true;
  return error.status===408||error.status===429||error.status>=500||error.code==='scheduled_artwork_rejected'||error.code==='reels_photo_layout_unreadable'||error.code==='scheduled_script_rejected';
}
