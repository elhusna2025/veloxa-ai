import sharp, { type OverlayOptions } from 'sharp';
import path from 'node:path';
// Next ships this licensed Latin font; trace it into the runtime instead of relying on OS fonts.
const visualFontFile=path.join(process.cwd(),'node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf');
import { ApiError } from './http';
export interface OriginalVisualAsset { id: string; role: 'logo' | 'screenshot'; bytes: Buffer }
export interface VisualCompositionParams {
 businessName: string; title: string; hook: string; cta: string;
 aspectRatio?: '4:5' | '9:16'; websiteUrl?: string; brandPalette?: string[];
 originalAssets?: OriginalVisualAsset[];
}
interface Rect { left: number; top: number; width: number; height: number }
export function compositionLayout(vertical: boolean, screenshot: boolean) {
 const width=1080, height=vertical?1920:1350, offset=vertical?128:0;
 return {width,height,brand:{left:48,top:48+offset,width:984,height:96},title:{left:48,top:184+offset,width:560,height:240},subtitle:{left:48,top:450+offset,width:560,height:116},hero:{left:0,top:0,width,height},screen:{left:48,top:vertical?1210:780,width:640,height:356},footer:{left:48,top:vertical?1620:1190,width:640,height:112}};
}
function escapeMarkup(value: string) { return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function invalid(): never {throw new ApiError(422,'Teks atau aset visual belum dapat ditata dengan jelas. Ringkas judul atau penjelasan, lalu coba lagi.','visual_composition_invalid');}
async function fitText(text: string, width: number, height: number, max: number, min: number, color: string, bold=false) {
 if (!text.trim()) return null;
 for(let size=max;size>=min;size-=2){
  const rendered=await sharp({text:{text:`<span foreground="${color}">${escapeMarkup(text)}</span>`,font:`Noto Sans ${bold?'bold ':''}${size}`,fontfile:visualFontFile,width,rgba:true,wrap:'word-char',spacing:5}}).png().toBuffer({resolveWithObject:true});
  if(rendered.info.height<=height&&rendered.info.width<=width)return rendered.data;
 }
 return invalid();
}
export function shortVisualCta(cta: string): string {return cta.trim().length<=36?cta.trim():'Pelajari selengkapnya';}
export function visualWebsite(url?: string): string {if(!url)return '';try{const parsed=new URL(url);return ['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.host:'';}catch{return '';}}
/** Original artwork is resized proportionally and layered after AI. Nothing is redrawn by AI. */
export async function composeSocialVisual(scene: Buffer, params: VisualCompositionParams): Promise<Buffer> {
 if(!Buffer.isBuffer(scene)||!scene.length||scene.length>20*1024*1024)return invalid();
 for(const [key,max] of [['businessName',300],['title',300],['hook',500],['cta',300]] as const)if(typeof params[key]!=='string'||!params[key].trim()||params[key].length>max)return invalid();
 const assets=params.originalAssets||[];
 if(assets.length>2||assets.some(asset=>!['logo','screenshot'].includes(asset.role)||!Buffer.isBuffer(asset.bytes)||!asset.bytes.length||asset.bytes.length>4*1024*1024)||new Set(assets.map(asset=>asset.role)).size!==assets.length)return invalid();
 const palette=params.brandPalette||[];if(palette.length>6||palette.some(color=>!/^#[a-f0-9]{6}$/i.test(color)))return invalid();
 const primary=palette[0]||'#173B57';
 const luminance=(hex:string)=>[1,3,5].map(start=>parseInt(hex.slice(start,start+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
 const vertical=params.aspectRatio==='9:16';const screen=assets.find(asset=>asset.role==='screenshot');const logo=assets.find(asset=>asset.role==='logo');const layout=compositionLayout(vertical,!!screen);
 const layers: OverlayOptions[]=[];
 const hero=await sharp(scene,{limitInputPixels:30_000_000}).rotate().resize(layout.hero.width,layout.hero.height,{fit:'cover',position:'north'}).png().toBuffer();layers.push({input:hero,left:0,top:0});
 // The scene stays edge-to-edge. Shade the copy area instead of adding opaque blank panels.
 const shade=Buffer.from(`<svg width="${layout.width}" height="${layout.height}"><defs><linearGradient id="left"><stop offset="0" stop-color="#061827" stop-opacity=".78"/><stop offset=".65" stop-color="#061827" stop-opacity=".35"/><stop offset="1" stop-color="#061827" stop-opacity="0"/></linearGradient><linearGradient id="top" x2="0" y2="1"><stop offset="0" stop-color="#061827" stop-opacity=".25"/><stop offset=".55" stop-color="#061827" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#left)"/><rect width="100%" height="100%" fill="url(#top)"/></svg>`);layers.push({input:shade,left:0,top:0});
 const headerBrand=await fitText(params.businessName,logo?760:984,72,34,22,'#FFFFFF',true);if(headerBrand)layers.push({input:headerBrand,left:logo?250:48,top:layout.brand.top+30});
 const headline=await fitText(params.title,layout.title.width,layout.title.height,76,28,'#FFFFFF',true);if(headline)layers.push({input:headline,left:layout.title.left,top:layout.title.top});
 // Reels narration remains in the audio; only the short overlay is printed.
 const subtitle=vertical?'':params.hook;
 const supporting=await fitText(subtitle,layout.subtitle.width,layout.subtitle.height,34,22,'#FFFFFF');if(supporting)layers.push({input:supporting,left:layout.subtitle.left,top:layout.subtitle.top});
 async function original(asset: OriginalVisualAsset, box: Rect) {
  const fitted=await sharp(asset.bytes,{limitInputPixels:30_000_000}).rotate().resize(box.width,box.height,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  layers.push({input:fitted.data,left:box.left+Math.floor((box.width-fitted.info.width)/2),top:box.top+Math.floor((box.height-fitted.info.height)/2)});
 }
 if(screen){const frame=Buffer.from(`<svg width="${layout.screen.width+24}" height="${layout.screen.height+24}"><rect width="100%" height="100%" rx="12" fill="#FFFFFF" stroke="#D5DFE5" stroke-width="2"/></svg>`);layers.push({input:frame,left:layout.screen.left-12,top:layout.screen.top-12});await original(screen,layout.screen);}
 if(logo)await original(logo,{left:48,top:layout.brand.top,width:180,height:96});
 const footer=Buffer.from(`<svg width="${layout.footer.width}" height="${layout.footer.height}"><rect width="100%" height="100%" rx="16" fill="${primary}"/></svg>`);layers.push({input:footer,left:layout.footer.left,top:layout.footer.top});
 // Choose the higher-contrast ink, including brands whose primary color is white.
 const foreground=luminance(primary)>.179?'#000000':'#FFFFFF';
 const cta=await fitText(shortVisualCta(params.cta),layout.footer.width-64,48,34,24,foreground,true);if(cta)layers.push({input:cta,left:80,top:layout.footer.top+16});
 const site=await fitText(visualWebsite(params.websiteUrl),layout.footer.width-64,36,27,20,foreground);if(site)layers.push({input:site,left:80,top:layout.footer.top+66});
 return sharp({create:{width:layout.width,height:layout.height,channels:3,background:'#061827'}}).composite(layers).png().toBuffer();
}
