/** Shared app limits. Final duration comes from the encoded media probe, never this estimate. */
export const REELS_SPEC={minDurationSeconds:20,maxDurationSeconds:60,encodingHeadroomSeconds:0.2,maxSourceAudioSeconds:90,minVoiceWords:40,maxVoiceWords:130,maxScriptChars:1800,maxSceneVoiceChars:360,sceneCount:4}as const;
export function reelsWordCount(text:string){return(text.match(/[\p{L}\p{N}]+/gu)||[]).length;}
export function estimateReelsDuration(text:string){return Math.min(REELS_SPEC.maxDurationSeconds,Math.max(REELS_SPEC.minDurationSeconds,Math.round(reelsWordCount(text)/2.2)));}
