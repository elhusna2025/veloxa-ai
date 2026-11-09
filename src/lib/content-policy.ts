import type { ContentDraft } from './veloxa-types';
/** Check every publishable text surface, including the hashtags appended by the publisher. */
export function forbiddenContentMatches(draft: Pick<ContentDraft,'title'|'hook'|'caption'|'hashtags'|'slides'|'videoScenes'>, words:string[]): string[] {
 const values=[draft.title,draft.hook,draft.caption,...draft.hashtags,...(draft.slides||[]).flatMap(slide=>[slide.headline,slide.body]),...(draft.videoScenes||[]).flatMap(scene=>[scene.textOverlay,scene.voiceover])];
 const text=values.filter(value=>typeof value==='string').join('\n').toLocaleLowerCase('id');
 return words.map(word=>word.trim()).filter(word=>word&&text.includes(word.toLocaleLowerCase('id')));
}
