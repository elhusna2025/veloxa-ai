import {GenerationStageError} from './content-generation-stream';

const minute=60_000;
const generationDelays=[2*minute];
const reelsArtworkDelays=[2*minute,3*minute,5*minute];
const publicationDelays=[2*minute,5*minute];

const recoveryDelays = { generation:generationDelays, reels_artwork:reelsArtworkDelays, publication:publicationDelays };

export function recoveryTime(kind:keyof typeof recoveryDelays, attempts:number, scheduledAt:number, now:number, nextSlot:number|null) {
  const delay=recoveryDelays[kind][attempts-1];
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
