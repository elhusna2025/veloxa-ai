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
export const CAROUSEL_ARTWORK = {
 logo: {left: 64, top: 56, width: 168, height: 90},
 screenshot: {left: 500, top: 866, width: 520, height: 224},
} satisfies Record<OriginalVisualAsset['role'], Rect>;
export const REELS_ARTWORK = {
 logo: {left: 70, top: 224, width: 168, height: 90},
 screenshot: {left: 180, top: 1050, width: 620, height: 224},
} satisfies Record<OriginalVisualAsset['role'], Rect>;

export const scheduledReelsCopyAreas = (hasLogo: boolean) => ({
  businessName: { left: hasLogo ? 262 : 70, top: 246, width: hasLogo ? 638 : 830, height: 108 },
  headline: { left: 70, top: 375, width: 780, height: 310 },
  cta: { left: 70, top: 1350, width: 810, height: 90 },
  website: { left: 70, top: 1460, width: 810, height: 130 },
}) satisfies Record<string, Rect>;

async function placeOriginalAsset(asset: OriginalVisualAsset, box: Rect, deviceFrame: boolean): Promise<OverlayOptions[]> {
 const fitted = await sharp(asset.bytes,{limitInputPixels:30_000_000}).rotate().resize(box.width,box.height,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
 const left = box.left + Math.floor((box.width - fitted.info.width) / 2);
 const top = box.top + Math.floor((box.height - fitted.info.height) / 2);
 const image = {input:fitted.data,left,top};
 if (!deviceFrame) return [image];
 const width = fitted.info.width + 48;
 const screenHeight = fitted.info.height + 24;
 const height = screenHeight + 18;
 const frame = Buffer.from(`<svg width="${width}" height="${height}"><rect x="12" width="${width-24}" height="${screenHeight}" rx="14" fill="#172331"/><path d="M0 ${screenHeight-2} H${width} V${screenHeight+6} Q${width-6} ${height-2} ${width-24} ${height-2} H24 Q6 ${height-2} 0 ${screenHeight+6} Z" fill="#8694A3"/></svg>`);
 return [{input:frame,left:left-24,top:top-12}, image];
}

export async function finishEditorialCarousel(artwork: Buffer, assets: OriginalVisualAsset[], vertical = false): Promise<Buffer> {
 const layout = vertical ? REELS_ARTWORK : CAROUSEL_ARTWORK;
 const image = sharp(artwork,{limitInputPixels:30_000_000}).rotate().resize(1080,vertical?1920:1350,{fit:'cover'});
 if (assets.length) {
  const overlays = await Promise.all(assets.map(asset => placeOriginalAsset(asset,layout[asset.role],asset.role==='screenshot')));
  image.composite(overlays.flat());
 }
 return image.jpeg({quality:94}).toBuffer();
}
export function compositionLayout(vertical: boolean, screenshot: boolean) {
 const width=1080, height=vertical?1920:1350;
 return {width,height,brand:{left:48,top:vertical?224:48,width:984,height:96},title:{left:48,top:vertical?360:184,width:vertical?640:680,height:vertical?340:252},subtitle:{left:48,top:470,width:680,height:228},hero:{left:0,top:0,width,height},screen:{left:48,top:vertical?1040:780,width:640,height:vertical?336:320},footer:{left:48,top:vertical?1448:1148,width:760,height:152}};
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

const linearColor = Array.from({ length: 256 }, (_, byte) => {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

type ReelsCopyKey = keyof ReturnType<typeof scheduledReelsCopyAreas>;
type FittedReelsText = NonNullable<Awaited<ReturnType<typeof fitCompositionText>>>;
const REELS_COPY_METRICS = {
  businessName: CONTENT_TYPOGRAPHY.brand, headline: CONTENT_TYPOGRAPHY.reelsTitle,
  cta: CONTENT_TYPOGRAPHY.cta, website: CONTENT_TYPOGRAPHY.website,
};
const OUTLINE = 6;

export async function prepareScheduledReelsCopy(copy: Record<ReelsCopyKey, string>, hasLogo: boolean) {
  const areas = scheduledReelsCopyAreas(hasLogo);
  const fitted: { key: ReelsCopyKey; box: Rect; text: FittedReelsText }[] = [];
  const captionLines: string[] = [];
  for (const key of Object.keys(areas) as ReelsCopyKey[]) {
    if (!copy[key].trim()) continue;
    let box = areas[key];
    const { max, min } = REELS_COPY_METRICS[key];
    const fit = async () => {
      const text = await fitCompositionText(copy[key], box.width - OUTLINE * 2, box.height - OUTLINE * 2, max, min, '#000000', key !== 'website');
      return text ?? invalid();
    };
    try {
      let text: FittedReelsText;
      try {
        text = await fit();
      } catch (error) {
        if (key !== 'headline' || !(error instanceof ApiError) || error.code !== 'visual_composition_invalid') throw error;
        box = { ...box, width: 830, height: 618 };
        text = await fit();
      }
      fitted.push({
        key, text, box: { left: box.left + OUTLINE, top: box.top + OUTLINE, width: text.width, height: text.height },
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'visual_composition_invalid') throw error;
      captionLines.push(copy[key]);
    }
  }
  return { fitted, captionLines };
}

function glyphLayer(alpha: Buffer, width: number, height: number, left: number, top: number, ink: 0 | 255): OverlayOptions {
  const input = Buffer.alloc(alpha.length * 4, ink);
  for (let index = 0; index < alpha.length; index++) input[index * 4 + 3] = alpha[index];
  return { input, raw: { width, height, channels: 4 }, left, top };
}

/** Preserve natural contrast where possible, otherwise outline the letters locally. */
export async function composeScheduledReelsCopy(
  photo: Buffer,
  fitted: Awaited<ReturnType<typeof prepareScheduledReelsCopy>>['fitted'],
): Promise<Buffer> {
  const width = 1080;
  const height = 1920;
  const pixels = await sharp(photo, { limitInputPixels: 30_000_000 }).rotate()
    .resize(width, height, { fit: 'cover' }).toColourspace('srgb').removeAlpha().raw().toBuffer();
  const layers: OverlayOptions[] = [];
  for (const { box, text } of fitted) {
    const mask = await sharp(text.data).extractChannel('alpha').toColourspace('b-w').raw().toBuffer();
    let darkest = 1;
    let brightest = 0;
    for (let y = 0; y < text.height; y++) {
      for (let x = 0; x < text.width; x++) {
        if (mask[y * text.width + x] < 220) continue;
        const offset = ((box.top + y) * width + box.left + x) * 3;
        const luminance = 0.2126 * linearColor[pixels[offset]] + 0.7152 * linearColor[pixels[offset + 1]] + 0.0722 * linearColor[pixels[offset + 2]];
        darkest = Math.min(darkest, luminance);
        brightest = Math.max(brightest, luminance);
      }
    }
    const darkContrast = (darkest + 0.05) / 0.05;
    const lightContrast = 1.05 / (brightest + 0.05);
    if (darkest <= brightest && Math.max(darkContrast, lightContrast) >= 4.5) {
      layers.push(glyphLayer(mask, text.width, text.height, box.left, box.top, darkContrast >= lightContrast ? 0 : 255));
      continue;
    }
    const paddedWidth = text.width + OUTLINE * 2;
    const paddedHeight = text.height + OUTLINE * 2;
    const alpha = Buffer.alloc(paddedWidth * paddedHeight);
    for (let y = 0; y < text.height; y++) {
      mask.copy(alpha, (y + OUTLINE) * paddedWidth + OUTLINE, y * text.width, (y + 1) * text.width);
    }
    // libvips erosion expands the brighter alpha pixels into their darker neighbors.
    const stroke = await sharp(alpha, { raw: { width: paddedWidth, height: paddedHeight, channels: 1 } })
      .erode(OUTLINE).toColourspace('b-w').raw().toBuffer();
    layers.push(glyphLayer(stroke, paddedWidth, paddedHeight, box.left - OUTLINE, box.top - OUTLINE, 0));
    layers.push(glyphLayer(mask, text.width, text.height, box.left, box.top, 255));
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).composite(layers).jpeg({ quality: 96 }).toBuffer();
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
 if (params.carouselSlide) {
  const width = layout.width - 128;
  const ink = '#10243B';
  const brandWidth = params.originalAssets?.some(asset => asset.role === 'logo') ? width - 144 : width;
  const headerBrand = await fitCompositionText(params.businessName,brandWidth,72,type.brand.max,type.brand.min,ink,true);
  let headline = await fitCompositionText(params.title,width,260,type.feedTitle.max,type.feedTitle.min,ink,true);
  let supporting = await fitCompositionText(params.hook,width,190,type.body.max,type.body.min,'#34495F');
  const cta = await fitCompositionText(shortVisualCta(params.cta),width,64,type.cta.max,type.cta.min,ink,true);
  const site = await fitCompositionText(cta ? visualWebsite(params.websiteUrl) : '',width,52,type.website.max,type.website.min,'#34495F');
  const footerHeight = cta ? cta.height + (site ? 12 + site.height : 0) + 26 : 0;
  const fixedHeight = 142 + 24 + footerHeight + 50;
  const minHeroHeight = 560;
  if (fixedHeight + (headline?.height || 0) + (supporting?.height || 0) > layout.height - minHeroHeight) {
   const bodyFloor = await fitCompositionText(params.hook,width,190,type.body.min,type.body.min,'#34495F');
   const available = layout.height - minHeroHeight - fixedHeight;
   headline = await fitCompositionText(params.title,width,available-(bodyFloor?.height || 0),type.feedTitle.max,type.feedTitle.min,ink,true);
   supporting = await fitCompositionText(params.hook,width,available-(headline?.height || 0),type.body.max,type.body.min,'#34495F');
  }
  const copyHeight = fixedHeight + (headline?.height || 0) + (supporting?.height || 0);
  const heroHeight = Math.min(840, layout.height - copyHeight);
  const supportingTop = heroHeight + 142 + (headline?.height || 0) + 24;
  return {headerBrand,headline,supporting,supportingTop,cta,site,heroHeight};
 }
 const copyColor = '#FFFFFF';
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
 const supportingTop=supporting?Math.max(bodyMinTop,Math.min(layout.subtitle.top,copyBottom-supporting.height)):layout.subtitle.top;
 const cta=await fitCompositionText(shortVisualCta(params.cta),layout.footer.width-64,64,type.cta.max,type.cta.min,foreground,true);
 const site=await fitCompositionText(visualWebsite(params.websiteUrl),layout.footer.width-64,52,type.website.max,type.website.min,foreground);
 return {headerBrand,headline,supporting,supportingTop,cta,site,heroHeight:layout.height};
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
 const vertical=params.aspectRatio==='9:16';const screen=assets.find(asset=>asset.role==='screenshot');const logo=assets.find(asset=>asset.role==='logo');const layout=compositionLayout(vertical,!!screen);
 const layers: OverlayOptions[]=[];
 const {headerBrand,headline,supporting,supportingTop,cta,site,heroHeight}=text;
 const hero=await sharp(scene,{limitInputPixels:30_000_000}).rotate().resize(layout.hero.width,heroHeight,{fit:'cover',position:params.carouselSlide?'centre':'north'}).png().toBuffer();
 layers.push({input:hero,left:0,top:0});
 // Integrated Studio feed artwork uses finishEditorialCarousel.
 if (params.carouselSlide) {
  const accent = Buffer.from(`<svg width="96" height="7"><rect width="96" height="7" rx="3.5" fill="${primary}"/></svg>`);
  layers.push({input:accent,left:64,top:heroHeight+32});
  if(headerBrand)layers.push({input:headerBrand.data,left:logo?208:64,top:heroHeight+65});
  if(headline)layers.push({input:headline.data,left:64,top:heroHeight+142});
  if(supporting)layers.push({input:supporting.data,left:64,top:supportingTop});
  if(logo)await original(logo,{left:64,top:heroHeight+56,width:120,height:66});
  if(screen)await original(screen,{left:500,top:heroHeight-248,width:520,height:210});
  if(cta){
   const top = supportingTop + (supporting?.height || 0) + 26;
   layers.push({input:cta.data,left:64,top});
   if(site)layers.push({input:site.data,left:64,top:top+cta.height+12});
  }
  return sharp({create:{width:layout.width,height:layout.height,channels:3,background:'#F6F8FB'}}).composite(layers).png().toBuffer();
 }
 const brandLeft = logo ? 250 : 48;
 const shade=Buffer.from(`<svg width="${layout.width}" height="${layout.height}"><defs><linearGradient id="left"><stop offset="0" stop-color="#061827" stop-opacity=".70"/><stop offset=".68" stop-color="#061827" stop-opacity=".70"/><stop offset="1" stop-color="#061827" stop-opacity="0"/></linearGradient><linearGradient id="top" x2="0" y2="1"><stop offset="0" stop-color="#061827" stop-opacity=".25"/><stop offset=".55" stop-color="#061827" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#left)"/><rect width="100%" height="100%" fill="url(#top)"/></svg>`);
 layers.push({input:shade,left:0,top:0});
 if(headerBrand)layers.push({input:headerBrand.data,left:brandLeft,top:layout.brand.top+30});
 if(headline)layers.push({input:headline.data,left:layout.title.left,top:layout.title.top});
 if(supporting)layers.push({input:supporting.data,left:layout.subtitle.left,top:supportingTop});
 async function original(asset: OriginalVisualAsset, box: Rect) {
  layers.push(...await placeOriginalAsset(asset,box,!!params.carouselSlide&&asset.role==='screenshot'));
 }
 if(screen&&!params.carouselSlide){const frame=Buffer.from(`<svg width="${layout.screen.width+24}" height="${layout.screen.height+24}"><rect width="100%" height="100%" rx="12" fill="#FFFFFF" stroke="#D5DFE5" stroke-width="2"/></svg>`);layers.push({input:frame,left:layout.screen.left-12,top:layout.screen.top-12});}
 if(screen)await original(screen,layout.screen);
 if(logo)await original(logo,{left:48,top:layout.brand.top,width:180,height:96});
 if(cta||site){
  const footer=Buffer.from(`<svg width="${layout.footer.width}" height="${layout.footer.height}"><rect width="100%" height="100%" rx="16" fill="${primary}"/></svg>`);
  layers.push({input:footer,left:layout.footer.left,top:layout.footer.top});
 }
 if(cta)layers.push({input:cta.data,left:80,top:layout.footer.top+16});
 if(site)layers.push({input:site.data,left:80,top:layout.footer.top+88});
 return sharp({create:{width:layout.width,height:layout.height,channels:3,background:'#061827'}}).composite(layers).png().toBuffer();
}
