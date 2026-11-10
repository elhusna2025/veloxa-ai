import sharp, { type OverlayOptions } from 'sharp';
import path from 'node:path';
// Next ships this licensed Latin font; trace it into the runtime instead of relying on OS fonts.
const visualFontFile=path.join(process.cwd(),'node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf');
import { ApiError } from './http';
import { CONTENT_TYPOGRAPHY } from '../content-typography';
export interface OriginalVisualAsset { id: string; role: 'logo' | 'screenshot'; bytes: Buffer }
export interface VisualCompositionParams {
 businessName: string; title: string; hook: string; cta: string;
 aspectRatio?: '4:5' | '9:16'; websiteUrl?: string; brandPalette?: string[];
 carouselSlide?: boolean;
 originalAssets?: OriginalVisualAsset[];
}
interface Rect { left: number; top: number; width: number; height: number }
export function compositionLayout(vertical: boolean, screenshot: boolean, carouselSlide = false) {
 const width=1080, height=vertical?1920:1350;
 return {width,height,brand:{left:48,top:vertical?224:48,width:984,height:96},title:{left:48,top:vertical?360:184,width:vertical?640:680,height:vertical?340:252},subtitle:{left:48,top:470,width:680,height:228},hero:{left:0,top:0,width,height},screen:{left:carouselSlide?376:48,top:vertical?1040:780,width:640,height:vertical?336:320},footer:{left:48,top:vertical?1448:1148,width:760,height:152}};
}
function escapeMarkup(value: string) { return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function invalid(): never {throw new ApiError(422,'Teks atau aset visual belum dapat ditata dengan jelas. Ringkas judul atau penjelasan, lalu coba lagi.','visual_composition_invalid');}
export async function fitCompositionText(text: string, width: number, height: number, max: number, min: number, color: string, bold=false) {
 if (!text.trim()) return null;
 for(let size=max;size>=min;size-=2){
  const rendered=await sharp({text:{text:`<span foreground="${color}">${escapeMarkup(text)}</span>`,font:`Noto Sans ${bold?'bold ':''}${size}`,fontfile:visualFontFile,width,rgba:true,wrap:'word-char',spacing:Math.round(size*CONTENT_TYPOGRAPHY.lineGapRatio)}}).png().toBuffer({resolveWithObject:true});
  if(rendered.info.height<=height&&rendered.info.width<=width)return {data:rendered.data,fontSize:size,width:rendered.info.width,height:rendered.info.height};
 }
 throw new ApiError(422,'Teks yang dibuat AI belum muat dengan ukuran yang nyaman dibaca. Coba buat ulang dengan pesan yang lebih singkat.','visual_composition_invalid');
}
export function shortVisualCta(cta: string): string {return cta.trim().length<=36?cta.trim():'Pelajari selengkapnya';}
export function visualWebsite(url?: string): string {if(!url)return '';try{const parsed=new URL(url);return ['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.host:'';}catch{return '';}}
function validateCompositionCopy(params: VisualCompositionParams) {
 for (const [key, max] of [['businessName', 300], ['title', 300], ['hook', 500], ['cta', 300]] as const) {
  const value = params[key];
  if (typeof value !== 'string' || (!value.trim() && !(key === 'cta' && params.carouselSlide)) || value.length > max) return invalid();
 }
}
/** The compositor and the paid-generation preflight use identical copy and font bounds. */
export async function renderCompositionText(params: VisualCompositionParams) {
 validateCompositionCopy(params);
 const vertical=params.aspectRatio==='9:16',layout=compositionLayout(vertical,false),type=CONTENT_TYPOGRAPHY;
 const titleType=vertical?type.reelsTitle:type.feedTitle;
 const primary=params.brandPalette?.[0]||'#173B57';
 const luminance=[1,3,5].map(start=>parseInt(primary.slice(start,start+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
 const foreground=luminance>.179?'#000000':'#FFFFFF';
 const copyColor = params.carouselSlide ? '#13263A' : '#FFFFFF';
 const headerBrand=await fitCompositionText(params.businessName,params.originalAssets?.some(asset=>asset.role==='logo')?760:984,72,type.brand.max,type.brand.min,copyColor,true);
 // Reserve the full screenshot frame even without an original, so the feed
 // text layout is consistent regardless of the reference roles.
 const copyBottom=layout.screen.top-32;
 const copyGap=24;
 const bodyFloor=vertical?null:await fitCompositionText(params.hook,layout.subtitle.width,copyBottom-layout.title.top,type.body.min,type.body.min,copyColor);
 const titleHeight=vertical?layout.title.height:copyBottom-layout.title.top-copyGap-(bodyFloor?.height||0);
 const headline=await fitCompositionText(params.title,layout.title.width,titleHeight,titleType.max,titleType.min,copyColor,true);
 const bodyMinTop=layout.title.top+(headline?.height||0)+copyGap;
 const supporting=vertical?null:await fitCompositionText(params.hook,layout.subtitle.width,copyBottom-bodyMinTop,type.body.max,type.body.min,copyColor);
 const supportingTop=supporting?(params.carouselSlide?bodyMinTop:Math.max(bodyMinTop,Math.min(layout.subtitle.top,copyBottom-supporting.height))):layout.subtitle.top;
 const cta=await fitCompositionText(shortVisualCta(params.cta),layout.footer.width-64,64,type.cta.max,type.cta.min,foreground,true);
 const site=await fitCompositionText(params.carouselSlide&&!cta?'':visualWebsite(params.websiteUrl),layout.footer.width-64,52,type.website.max,type.website.min,foreground);
 return {headerBrand,headline,supporting,supportingTop,cta,site};
}
export async function preflightSocialVisualText(params: VisualCompositionParams): Promise<void> { await renderCompositionText(params); }
/** Original artwork is resized proportionally and layered after AI. Nothing is redrawn by AI. */
export async function composeSocialVisual(scene: Buffer, params: VisualCompositionParams): Promise<Buffer> {
 if(!Buffer.isBuffer(scene)||!scene.length||scene.length>20*1024*1024)return invalid();
 const assets=params.originalAssets||[];
 if(assets.length>2||assets.some(asset=>!['logo','screenshot'].includes(asset.role)||!Buffer.isBuffer(asset.bytes)||!asset.bytes.length||asset.bytes.length>4*1024*1024)||new Set(assets.map(asset=>asset.role)).size!==assets.length)return invalid();
 const palette=params.brandPalette||[];if(palette.length>6||palette.some(color=>!/^#[a-f0-9]{6}$/i.test(color)))return invalid();
 const primary=palette[0]||'#173B57';
 const text=await renderCompositionText(params);
 const vertical=params.aspectRatio==='9:16';const screen=assets.find(asset=>asset.role==='screenshot');const logo=assets.find(asset=>asset.role==='logo');const layout=compositionLayout(vertical,!!screen,params.carouselSlide);
 const layers: OverlayOptions[]=[];
 const hero=await sharp(scene,{limitInputPixels:30_000_000}).rotate().resize(layout.hero.width,layout.hero.height,{fit:'cover',position:'north'}).png().toBuffer();layers.push({input:hero,left:0,top:0});
 const {headerBrand,headline,supporting,supportingTop}=text;
 const brandLeft = logo ? 250 : 48;
 if (params.carouselSlide) {
  const left = 24;
  const top = layout.brand.top - 20;
  const width = Math.max(brandLeft + (headerBrand?.width || 0), layout.title.left + (headline?.width || 0), layout.subtitle.left + (supporting?.width || 0)) + 24 - left;
  const height = supportingTop + (supporting?.height || 0) + 16 - top;
  const panel = Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" rx="24" fill="#FFFFFF" fill-opacity=".94"/></svg>`);
  layers.push({ input: panel, left, top });
 } else {
  const shade=Buffer.from(`<svg width="${layout.width}" height="${layout.height}"><defs><linearGradient id="left"><stop offset="0" stop-color="#061827" stop-opacity=".70"/><stop offset=".68" stop-color="#061827" stop-opacity=".70"/><stop offset="1" stop-color="#061827" stop-opacity="0"/></linearGradient><linearGradient id="top" x2="0" y2="1"><stop offset="0" stop-color="#061827" stop-opacity=".25"/><stop offset=".55" stop-color="#061827" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#left)"/><rect width="100%" height="100%" fill="url(#top)"/></svg>`);
  layers.push({input:shade,left:0,top:0});
 }
 if(headerBrand)layers.push({input:headerBrand.data,left:brandLeft,top:layout.brand.top+30});
 if(headline)layers.push({input:headline.data,left:layout.title.left,top:layout.title.top});
 if(supporting)layers.push({input:supporting.data,left:layout.subtitle.left,top:supportingTop});
 async function original(asset: OriginalVisualAsset, box: Rect) {
  const fitted=await sharp(asset.bytes,{limitInputPixels:30_000_000}).rotate().resize(box.width,box.height,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  const left = box.left + Math.floor((box.width - fitted.info.width) / 2);
  const top = box.top + Math.floor((box.height - fitted.info.height) / 2);
  if (params.carouselSlide && asset.role === 'screenshot') {
   const width = fitted.info.width + 48;
   const screenHeight = fitted.info.height + 24;
   const height = screenHeight + 18;
   const frame = Buffer.from(`<svg width="${width}" height="${height}"><rect x="12" width="${width-24}" height="${screenHeight}" rx="14" fill="#172331"/><path d="M0 ${screenHeight-2} H${width} V${screenHeight+6} Q${width-6} ${height-2} ${width-24} ${height-2} H24 Q6 ${height-2} 0 ${screenHeight+6} Z" fill="#8694A3"/></svg>`);
   layers.push({ input: frame, left: left - 24, top: top - 12 });
  }
  layers.push({input:fitted.data,left,top});
 }
 if(screen&&!params.carouselSlide){const frame=Buffer.from(`<svg width="${layout.screen.width+24}" height="${layout.screen.height+24}"><rect width="100%" height="100%" rx="12" fill="#FFFFFF" stroke="#D5DFE5" stroke-width="2"/></svg>`);layers.push({input:frame,left:layout.screen.left-12,top:layout.screen.top-12});}
 if(screen)await original(screen,layout.screen);
 if(logo)await original(logo,{left:48,top:layout.brand.top,width:180,height:96});
 const {cta,site}=text;
 if(cta||site){
  const footer=Buffer.from(`<svg width="${layout.footer.width}" height="${layout.footer.height}"><rect width="100%" height="100%" rx="16" fill="${primary}"/></svg>`);
  layers.push({input:footer,left:layout.footer.left,top:layout.footer.top});
 }
 if(cta)layers.push({input:cta.data,left:80,top:layout.footer.top+16});
 if(site)layers.push({input:site.data,left:80,top:layout.footer.top+88});
 return sharp({create:{width:layout.width,height:layout.height,channels:3,background:'#061827'}}).composite(layers).png().toBuffer();
}
