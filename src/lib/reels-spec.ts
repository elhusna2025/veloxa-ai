/** Shared app limits. Final duration comes from the encoded media probe, never this estimate. */
export const REELS_SPEC={minDurationSeconds:20,maxDurationSeconds:60,encodingHeadroomSeconds:0.2,maxSourceAudioSeconds:90,minVoiceWords:40,maxVoiceWords:130,maxScriptChars:1800,maxSceneVoiceChars:360,sceneCount:4,maxPhotoZoom:1.09}as const;
const maxZoom = REELS_SPEC.maxPhotoZoom;
export const REELS_PHOTO_MOTIONS = [
  { zoom: [1, maxZoom], horizontal: [0.49, 0.49] },
  { zoom: [maxZoom, maxZoom], horizontal: [0.10, 0.90] },
  { zoom: [maxZoom, maxZoom], horizontal: [0.90, 0.10] },
  { zoom: [maxZoom, 1], horizontal: [0.52, 0.52] },
] as const;
export const REELS_PHOTO_VERTICAL_ANCHOR = 0.57;
export function reelsWordCount(text:string){return(text.match(/[\p{L}\p{N}]+/gu)||[]).length;}
export function estimateReelsDuration(text:string){return Math.min(REELS_SPEC.maxDurationSeconds,Math.max(REELS_SPEC.minDurationSeconds,Math.round(reelsWordCount(text)/2.2)));}
