import sharp, { type OverlayOptions } from 'sharp';
import path from 'node:path';
import { ApiError } from './http';
import { CONTENT_TYPOGRAPHY } from '../content-typography';
import { REELS_SPEC } from '../reels-spec';

// Next ships this licensed Latin font; trace it into the runtime instead of relying on OS fonts.
const visualFontFile=path.join(process.cwd(),'node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf');
const reelsFontDirectory = path.join(process.cwd(), 'src/lib/server/fonts/inter');
const reelsHeadlineFont = path.join(reelsFontDirectory, 'Inter-ExtraBold.ttf');
const reelsLabelFont = path.join(reelsFontDirectory, 'Inter-Medium.ttf');
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
export const REELS_ACCENT = { left: 70, top: 343, width: 88, height: 8 } satisfies Rect;

export const scheduledReelsCopyAreas = (hasLogo: boolean) => ({
  businessName: { left: hasLogo ? 242 : 70, top: 243, width: hasLogo ? 658 : 830, height: 88 },
  headline: { left: 70, top: 375, width: 810, height: 310 },
  cta: { left: 70, top: 1380, width: 810, height: 82 },
  website: { left: 70, top: 1472, width: 810, height: 116 },
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
async function fitText(text: string, width: number, height: number, max: number, min: number, color: string, style: {
  font: string; file: string; wrap: 'word' | 'word-char'; gapRatio: number;
}) {
  if (!text.trim()) return null;
  for (let size = max; size >= min; size -= 2) {
    const rendered = await sharp({ text: {
      text: `<span foreground="${color}">${escapeMarkup(text)}</span>`,
      font: `${style.font} ${size}`, fontfile: style.file, width, rgba: true,
      wrap: style.wrap, spacing: Math.round(size * style.gapRatio),
    } }).png().toBuffer({ resolveWithObject: true });
    if (rendered.info.height <= height && rendered.info.width <= width) {
      return { data: rendered.data, fontSize: size, width: rendered.info.width, height: rendered.info.height };
    }
  }
  throw new ApiError(422, 'Teks yang dibuat AI belum muat dengan ukuran yang nyaman dibaca. Coba buat ulang dengan pesan yang lebih singkat.', 'visual_composition_invalid');
}

export function fitCompositionText(text: string, width: number, height: number, max: number, min: number, color: string, bold = false) {
  return fitText(text, width, height, max, min, color, {
    font: bold ? 'Noto Sans Bold' : 'Noto Sans', file: visualFontFile,
    wrap: 'word-char', gapRatio: CONTENT_TYPOGRAPHY.lineGapRatio,
  });
}

const linearColor = Array.from({ length: 256 }, (_, byte) => {
  const channel = byte / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

type ReelsCopyKey = keyof ReturnType<typeof scheduledReelsCopyAreas>;
type ReelsCopy = Record<ReelsCopyKey, string>;
type FittedReelsText = NonNullable<Awaited<ReturnType<typeof fitText>>>;
const REELS_COPY_METRICS = {
  businessName: CONTENT_TYPOGRAPHY.brand, headline: CONTENT_TYPOGRAPHY.reelsTitle,
  cta: CONTENT_TYPOGRAPHY.cta, website: CONTENT_TYPOGRAPHY.website,
};
const OUTLINE_PADDING = 6;

export async function prepareScheduledReelsCopy(copy: ReelsCopy, hasLogo: boolean, headlineMax: number = CONTENT_TYPOGRAPHY.reelsTitle.max) {
  const areas = scheduledReelsCopyAreas(hasLogo);
  const fitted: { key: ReelsCopyKey; box: Rect; text: FittedReelsText }[] = [];
  const captionLines: string[] = [];
  for (const key of Object.keys(areas) as ReelsCopyKey[]) {
    if (!copy[key].trim()) continue;
    let box = areas[key];
    const { max, min } = REELS_COPY_METRICS[key];
    const headline = key === 'headline';
    const fit = async () => {
      const text = await fitText(copy[key], box.width - OUTLINE_PADDING * 2, box.height - OUTLINE_PADDING * 2,
        headline ? headlineMax : max, min, '#000000', {
          font: headline ? 'Inter Ultra-Bold' : 'Inter Medium',
          file: headline ? reelsHeadlineFont : reelsLabelFont,
          wrap: headline ? 'word' : 'word-char',
          gapRatio: headline ? CONTENT_TYPOGRAPHY.reelsHeadlineGapRatio : CONTENT_TYPOGRAPHY.lineGapRatio,
        });
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
        key, text, box: { left: box.left + OUTLINE_PADDING, top: box.top + OUTLINE_PADDING, width: text.width, height: text.height },
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'visual_composition_invalid') throw error;
      captionLines.push(copy[key]);
    }
  }
  return { fitted, captionLines };
}

/** Choose one headline size for the whole video before generating any photographs. */
export async function prepareReelsCopyBatch(copies: ReelsCopy[], hasLogo: boolean) {
  const initial = await Promise.all(copies.map(copy => prepareScheduledReelsCopy(copy, hasLogo)));
  const headlineSizes = initial.map(scene => scene.fitted.find(item => item.key === 'headline')?.text.fontSize);
  const sharedSize = Math.min(CONTENT_TYPOGRAPHY.reelsTitle.max, ...headlineSizes.flatMap(size => size === undefined ? [] : [size]));
  return Promise.all(initial.map((scene, index) => {
    const size = headlineSizes[index];
    return size !== undefined && size > sharedSize ? prepareScheduledReelsCopy(copies[index], hasLogo, sharedSize) : scene;
  }));
}

type Ink = readonly [number, number, number];
const EDITORIAL_INK: Ink = [16, 36, 59];
const WHITE: Ink = [255, 255, 255];
const BLACK: Ink = [0, 0, 0];
const DEFAULT_ACCENT: Ink = [32, 103, 164];
const luminance = (r: number, g: number, b: number) =>
  0.2126 * linearColor[r] + 0.7152 * linearColor[g] + 0.0722 * linearColor[b];

function glyphLayer(alpha: Buffer, width: number, height: number, left: number, top: number, ink: Ink): OverlayOptions {
  const input = Buffer.allocUnsafe(alpha.length * 4);
  for (let index = 0; index < alpha.length; index++) {
    const offset = index * 4;
    input[offset] = ink[0];
    input[offset + 1] = ink[1];
    input[offset + 2] = ink[2];
    input[offset + 3] = alpha[index];
  }
  return { input, raw: { width, height, channels: 4 }, left, top };
}

const REELS_MASTER = { width: 1080, height: 1920 } as const;
const REELS_OUTPUT = { width: 720, height: 1280 } as const;

async function renderReelsOverlay(layers: OverlayOptions[]) {
  const canvas = sharp({ create: { ...REELS_MASTER, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  if (layers.length) canvas.composite(layers);
  const png = await canvas.png().toBuffer();
  return sharp(png).resize(REELS_OUTPUT.width, REELS_OUTPUT.height).png().toBuffer();
}

export async function composeReelsOriginalOverlay(assets: OriginalVisualAsset[]) {
  if (!assets.length) return undefined;
  const layers = await Promise.all(assets.map(asset => placeOriginalAsset(asset, REELS_ARTWORK[asset.role], asset.role === 'screenshot')));
  return renderReelsOverlay(layers.flat());
}

export interface ReelsArtworkFrame {
  image: Buffer;
  photo: Buffer;
  overlay: Buffer;
}

type LuminanceRange = { darkest: number; brightest: number };

function sweptLuminance(pixels: Buffer, box: Rect): LuminanceRange {
  const { width, height } = REELS_MASTER;
  const zoom = REELS_SPEC.maxPhotoZoom;
  const left = Math.max(0, Math.floor(box.left / zoom) - 2);
  const top = Math.max(0, Math.floor(box.top / zoom) - 2);
  const right = Math.min(width, Math.ceil(width - (width - box.left - box.width) / zoom) + 2);
  const bottom = Math.min(height, Math.ceil(height - (height - box.top - box.height) / zoom) + 2);
  let darkest = 1;
  let brightest = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 3;
      const value = luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      darkest = Math.min(darkest, value);
      brightest = Math.max(brightest, value);
    }
  }
  return { darkest, brightest };
}

function minimumContrast(ink: Ink, { darkest, brightest }: LuminanceRange) {
  const value = luminance(...ink);
  if (value <= darkest) return (darkest + 0.05) / (value + 0.05);
  if (value >= brightest) return (value + 0.05) / (brightest + 0.05);
  return 1;
}

function editorialInk(range: LuminanceRange) {
  return [EDITORIAL_INK, WHITE, BLACK].find(ink => minimumContrast(ink, range) >= 4.5);
}

function accentInk(pixels: Buffer, brandPalette: string[]): Ink {
  const range = sweptLuminance(pixels, REELS_ACCENT);
  const candidates = brandPalette.filter(color => /^#[\da-f]{6}$/i.test(color))
    .map((color): Ink => [
      parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16),
    ]);
  return [...candidates, DEFAULT_ACCENT, EDITORIAL_INK, WHITE].find(ink => minimumContrast(ink, range) >= 3)
    ?? (minimumContrast(WHITE, range) >= minimumContrast(BLACK, range) ? WHITE : BLACK);
}

/** Check contrast across the photo area that can pass behind each fixed line of copy. */
export async function composeReelsScene(
  photo: Buffer,
  fitted: Awaited<ReturnType<typeof prepareScheduledReelsCopy>>['fitted'],
  fixedOverlay?: Buffer,
  brandPalette: string[] = [],
): Promise<ReelsArtworkFrame> {
  const { width, height } = REELS_MASTER;
  const pixels = await sharp(photo, { limitInputPixels: 30_000_000 }).rotate()
    .resize(width, height, { fit: 'cover' }).toColourspace('srgb').removeAlpha().raw().toBuffer();
  const layers: OverlayOptions[] = [];
  const copyRegions = fitted.map(item => ({ ...item, range: sweptLuminance(pixels, item.box) }));
  const sceneInk = editorialInk({
    darkest: Math.min(...copyRegions.map(item => item.range.darkest)),
    brightest: Math.max(...copyRegions.map(item => item.range.brightest)),
  });
  if (fitted.some(item => item.key === 'headline')) {
    const { width, height, left, top } = REELS_ACCENT;
    layers.push(glyphLayer(Buffer.alloc(width * height, 255), width, height, left, top, accentInk(pixels, brandPalette)));
  }
  for (const { key, box, text, range } of copyRegions) {
    const mask = await sharp(text.data).extractChannel('alpha').toColourspace('b-w').raw().toBuffer();
    const ink = sceneInk ?? editorialInk(range);
    if (ink) {
      layers.push(glyphLayer(mask, text.width, text.height, box.left, box.top, ink));
      continue;
    }
    const outline = key === 'headline' ? 4 : 3;
    const paddedWidth = text.width + outline * 2;
    const paddedHeight = text.height + outline * 2;
    const alpha = Buffer.alloc(paddedWidth * paddedHeight);
    for (let y = 0; y < text.height; y++) {
      mask.copy(alpha, (y + outline) * paddedWidth + outline, y * text.width, (y + 1) * text.width);
    }
    // libvips erosion expands the brighter alpha pixels into their darker neighbors.
    const stroke = await sharp(alpha, { raw: { width: paddedWidth, height: paddedHeight, channels: 1 } })
      .erode(outline).toColourspace('b-w').raw().toBuffer();
    layers.push(glyphLayer(stroke, paddedWidth, paddedHeight, box.left - outline, box.top - outline, BLACK));
    layers.push(glyphLayer(mask, text.width, text.height, box.left, box.top, WHITE));
  }
  const [background, overlay] = await Promise.all([
    sharp(pixels, { raw: { width, height, channels: 3 } }).resize(REELS_OUTPUT.width, REELS_OUTPUT.height).jpeg({ quality: 94 }).toBuffer(),
    renderReelsOverlay(layers),
  ]);
  const image = await sharp(background).composite([
    { input: overlay },
    ...(fixedOverlay ? [{ input: fixedOverlay }] : []),
  ]).jpeg({ quality: 94 }).toBuffer();
  return { image, photo: background, overlay };
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
