import {GenerationStageError} from './content-generation-stream';

const minute=60_000;
const generationDelays=[2*minute];
const publicationDelays=[2*minute,5*minute];

export function recoveryTime(kind:'generation'|'publication', attempts:number, scheduledAt:number, now:number, nextSlot:number|null) {
  const delay=(kind==='generation'?generationDelays:publicationDelays)[attempts-1];
  const due=now+delay;
  // Recovery yields to the next scheduled slot.
  const deadline=Math.min(scheduledAt+30*minute,nextSlot===null?Infinity:nextSlot);
  return delay&&due<deadline?due:null;
}

export function canRetryGeneration(error:unknown) {
  if(!(error instanceof GenerationStageError))return false;
  // Saving may already have written a draft; never generate another from an uncertain write.
  if(error.stage==='saving'||error.stage==='validation')return false;
  return error.status===408||error.status===429||error.status>=500||error.code==='scheduled_artwork_rejected'||error.code==='scheduled_script_rejected';
}
