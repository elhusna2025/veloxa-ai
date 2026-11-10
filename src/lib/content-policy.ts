import type { ContentDraft } from './veloxa-types';
/** Check every publishable text surface, including the hashtags appended by the publisher. */
export function forbiddenContentMatches(draft: Pick<ContentDraft,'title'|'hook'|'caption'|'hashtags'|'slides'|'videoScenes'|'visualText'>, words:string[]): string[] {
 if(draft.visualText!==undefined&&(!Array.isArray(draft.visualText)||draft.visualText.some(value=>typeof value!=='string')))throw new Error('Teks visual tersimpan tidak valid.');
 const values=[...(draft.visualText||[]),draft.title,draft.hook,draft.caption,...draft.hashtags,...(draft.slides||[]).flatMap(slide=>[slide.headline,slide.body]),...(draft.videoScenes||[]).flatMap(scene=>[scene.textOverlay,scene.voiceover])];
 const text=values.filter(value=>typeof value==='string').join('\n').toLocaleLowerCase('id');
 return words.map(word=>word.trim()).filter(word=>word&&text.includes(word.toLocaleLowerCase('id')));
}
