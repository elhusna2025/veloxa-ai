import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CAROUSEL_ARTWORK, REELS_ARTWORK, composeReelsOriginalOverlay, composeReelsScene, composeSocialVisual, finishEditorialCarousel, compositionLayout, prepareReelsCopyBatch, prepareScheduledReelsCopy, reelsUnderlineArea, renderCompositionText, shortVisualCta, visualWebsite } from './content-compositor';
import { resolveReferenceRoles } from '../content-reference-roles';
import { CONTENT_TYPOGRAPHY } from '../content-typography';
const params={businessName:'Berez ERP',title:'Penjualan & Stok Lebih Terpantau',hook:'Kelola transaksi dan persediaan dalam satu sistem.',cta:'Kenali Berez ERP',websiteUrl:'https://berez.dafinicode.com/',brandPalette:['#0061AD','#FFFFFF']};
const cendekiaPalette = ['#079BE5', '#FBC905', '#FA5308', '#056BCA', '#063F9B', '#FEFACE'];
async function pixelSource(width:number,height:number){const data=Buffer.alloc(width*height*3);for(let i=0;i<data.length;i++)data[i]=(i*29+47)%256;return sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();}

async function runWithIsolatedFonts(script: string) {
 const{mkdtemp,writeFile,rm,mkdir}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const path=await import('node:path');const{execFile}=await import('node:child_process');const{promisify}=await import('node:util');const dir=await mkdtemp(path.join(tmpdir(),'veloxa-isolated-font-'));
 try{await mkdir(path.join(dir,'empty'));const config=path.join(dir,'fonts.conf');await writeFile(config,`<?xml version="1.0"?><fontconfig><dir>${dir}/empty</dir><cachedir>${dir}/cache</cachedir></fontconfig>`);
  await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,FONTCONFIG_FILE:config,FONTCONFIG_PATH:dir},timeout:30000});
 }finally{await rm(dir,{recursive:true,force:true});}
}

test('bundled font renders readable Latin copy without any installed system fonts',async()=>{
 const script=`import sharp from 'sharp';import assert from 'node:assert/strict';import{composeSocialVisual,compositionLayout}from './src/lib/server/content-compositor.ts';const scene=await sharp({create:{width:1080,height:1350,channels:3,background:'#000000'}}).jpeg().toBuffer();const output=await composeSocialVisual(scene,${JSON.stringify(params)});const box=compositionLayout(false,false).title;const rendered=await sharp(output).extract(box).threshold(230).trim({background:'#000000'}).png().toBuffer({resolveWithObject:true});assert.ok(rendered.info.width>400,'Latin headline must not degrade into narrow missing-glyph boxes');assert.ok(rendered.info.height>55,'Latin headline must retain its intended font size');`;
 await runWithIsolatedFonts(script);
});

test('bundled Reels fonts retain distinct weights with readable Latin glyphs in an isolated font config', async () => {
 await runWithIsolatedFonts(`
   import assert from 'node:assert/strict';
   import { readFile } from 'node:fs/promises';
   import sharp from 'sharp';
   import { prepareReelsCopyBatch } from './src/lib/server/content-compositor.ts';

   for (const face of ['Inter-ExtraBold.ttf', 'Inter-Medium.ttf']) {
     const font = await readFile(new URL('./src/lib/server/fonts/inter/' + face, import.meta.url));
     assert.equal(font.readUInt32BE(0), 0x00010000, face + ' must be a bundled TrueType face');
   }
   const value = 'Satu topik';
   const [{ fitted, captionLines }] = await prepareReelsCopyBatch([
     { businessName: value, headline: value, cta: '', website: '' },
   ], false);
   assert.deepEqual(captionLines, []);
   const headline = fitted.find(({ key }) => key === 'headline').text;
   const brand = fitted.find(({ key }) => key === 'businessName').text;
   assert.ok(headline.width > 280 && headline.height > 48);
   assert.ok(brand.width > 100 && brand.height > 20);
   const inkDensity = async ({ data }) => {
     const mask = await sharp(data).extractChannel('alpha').raw().toBuffer();
     return mask.reduce((sum, alpha) => sum + alpha / 255, 0) / mask.length;
   };
   assert.ok(await inkDensity(headline) > (await inkDensity(brand)) + 0.06,
     'headline needs a visibly heavier face than the brand label');
 `);
});

test('Reels scenes share headline size and use readable brand ink with a curved underline', async () => {
 const copies = [
   { headline: 'Kenapa Jawabanku Salah?', cta: '', website: '' },
   { headline: 'Tandai langkah pertama', cta: '', website: '' },
   { headline: 'Pahami kesalahan sebelum mengulang latihan', cta: '', website: '' },
   { headline: 'Coba satu soal serupa', cta: 'Pelajari selengkapnya', website: 'cendekiaai.com' },
 ].map(copy => ({ businessName: 'Cendekia AI', ...copy }));
 const prepared = await prepareReelsCopyBatch(copies, true);
 assert.equal(prepared.length, 4);
 const headlines = prepared.map(({ fitted, captionLines }) => {
   assert.deepEqual(captionLines, []);
   const headline = fitted.find(({ key }) => key === 'headline');
   assert.ok(headline);
   for (const { box } of fitted) {
     assert.ok(box.left >= 0 && box.left + box.width <= 1080);
     assert.ok(box.top >= 224 && box.top + box.height <= 1600);
   }
   const underline = reelsUnderlineArea(headline.box);
   assert.ok(underline.top >= headline.box.top + headline.box.height);
   assert.ok(underline.top + underline.height < REELS_ARTWORK.screenshot.top);
   assert.ok(underline.left >= 0 && underline.left + underline.width <= 1080);
   return { headline, underline };
 });
 const firstHeadline = headlines[0].headline;
 assert.ok(firstHeadline.text.fontSize >= CONTENT_TYPOGRAPHY.reelsTitle.min);
 for (const { headline } of headlines) {
   assert.equal(headline.text.fontSize, firstHeadline.text.fontSize);
   assert.equal(headline.box.left, firstHeadline.box.left);
   assert.equal(headline.box.top, firstHeadline.box.top);
 }
 assert.ok(new Set(headlines.map(({ underline }) => underline.top)).size > 1,
   'underline follows the actual height of each headline');
 const wideCopy = { ...copies[2], headline: Array(6).fill('WWWWWWW').join(' ') };
 const comparison = [copies[0], wideCopy];
 const independent = await Promise.all(comparison.map(copy => prepareScheduledReelsCopy(copy, true)));
 const independentSizes = independent.map(({ fitted }) => {
   const headline = fitted.find(({ key }) => key === 'headline');
   assert.ok(headline);
   return headline.text.fontSize;
 });
 const constrained = await prepareReelsCopyBatch(comparison, true);
 const constrainedSizes = constrained.map(({ fitted }) => fitted.find(({ key }) => key === 'headline')?.text.fontSize);
 const sharedSize = Math.min(...independentSizes);
 assert.deepEqual(constrainedSizes, [sharedSize, sharedSize], 'the smallest fitted size applies to the whole set');

 const backgrounds = ['#F3EEE4', '#FAF8F2', '#131C25', '#F8E9D3'];
 const frames = await Promise.all(prepared.map(async ({ fitted }, index) => {
   const photo = await sharp({
     create: { width: 1080, height: 1920, channels: 3, background: backgrounds[index] },
   }).png().toBuffer();
   return composeReelsScene(photo, fitted, undefined, cendekiaPalette);
 }));
 const outputScale = 720 / 1080;
 const outputArea = ({ left, top, width, height }: typeof firstHeadline.box) => ({
   left: Math.floor(left * outputScale),
   top: Math.floor(top * outputScale),
   width: Math.ceil(width * outputScale),
   height: Math.ceil(height * outputScale),
 });
 const matchesRgb = (pixels: Buffer, offset: number, expected: number[]) =>
   expected.every((value, channel) => Math.abs(value - pixels[offset + channel]) <= 4);
 for (const [index, { overlay }] of frames.entries()) {
   const { headline, underline } = headlines[index];
   const accentBox = outputArea(underline);
   const accent = await sharp(overlay).extract(accentBox).raw().toBuffer();
   const goldRows = new Set<number>();
   let goldColumns = 0;
   for (let x = 0; x < accentBox.width; x++) {
     for (let y = 0; y < accentBox.height; y++) {
       const offset = 4 * (y * accentBox.width + x);
       if (accent[offset + 3] < 245 || !matchesRgb(accent, offset, [0xFB, 0xC9, 0x05])) continue;
       goldRows.add(y);
       goldColumns++;
       break;
     }
   }
   assert.ok(goldColumns > accentBox.width / 2, 'gold underline is visible on dark and light photographs');
   assert.ok(goldRows.size > 2, 'underline curves rather than forming a horizontal rule');
   const ink = await sharp(overlay).extract(outputArea(headline.box)).raw().toBuffer();
   const expected = index === 2 ? [255, 255, 255] : [0x06, 0x3F, 0x9B];
   let opaquePixels = 0;
   let matchingPixels = 0;
   for (let offset = 0; offset < ink.length; offset += 4) {
     if (ink[offset + 3] !== 255) continue;
     opaquePixels++;
     if (matchesRgb(ink, offset, expected)) matchingPixels++;
   }
   assert.ok(matchingPixels > opaquePixels / 2,
     'pale photos use the darkest readable brand color and dark photos use white');
 }
});

test('Reels accepts clean dark space and rejects high contrast clutter behind its type', async () => {
 const { fitted } = await prepareScheduledReelsCopy({
   businessName: 'Cendekia AI', headline: 'Cara Membahas Soal TKA', cta: '', website: '',
 }, false);
 const size = { width: 1080, height: 1920 };
 const dark = await sharp({ create: { ...size, channels: 3, background: '#121C30' } }).png().toBuffer();
 const stripes = Buffer.alloc(size.width * size.height * 3);
 for (let x = 0; x < size.width; x++) {
   const value = Math.floor(x / 90) % 2 * 255;
   for (let y = 0; y < size.height; y++) {
     const offset = (y * size.width + x) * 3;
     stripes.fill(value, offset, offset + 3);
   }
 }
 const busy = await sharp(stripes, { raw: { ...size, channels: 3 } }).png().toBuffer();
 await assert.rejects(composeReelsScene(busy, fitted, undefined, cendekiaPalette),
   { code: 'reels_photo_layout_unreadable' });

 const { overlay, image } = await composeReelsScene(dark, fitted, undefined, cendekiaPalette);
 const headline = fitted.find(item => item.key === 'headline');
 assert.ok(headline);
 const scale = 720 / 1080;
 const title = await sharp(overlay).extract({
   left: Math.floor(headline.box.left * scale),
   top: Math.floor(headline.box.top * scale),
   width: Math.ceil(headline.box.width * scale),
   height: Math.ceil(headline.box.height * scale),
 }).raw().toBuffer();
 let white = 0;
 for (let offset = 0; offset < title.length; offset += 4) {
   if (title[offset + 3] < 230) continue;
   assert.ok(title[offset] >= 245 && title[offset + 1] >= 245 && title[offset + 2] >= 245,
     'opaque title pixels must be white without a black outline');
   white++;
 }
 assert.ok(white > 200);
 const unaffected = await sharp(image).extract({ left: 20, top: 620, width: 30, height: 20 }).raw().toBuffer();
 const background = await sharp(dark).resize(720, 1280).extract({ left: 20, top: 620, width: 30, height: 20 }).raw().toBuffer();
 assert.ok(unaffected.every((value, index) => Math.abs(value - background[index]) <= 3),
   'the original dark photograph remains visible outside copy');
});

test('Reels moves its headline and underline together into quiet space on the same photograph', async () => {
 const { fitted } = await prepareScheduledReelsCopy({
   businessName: 'Cendekia AI', headline: 'Cara Membahas Soal TKA', cta: '', website: '',
 }, false);
 const headline = fitted.find(item => item.key === 'headline');
 assert.ok(headline);
 const { box } = headline;
 const photo = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#edf3f7' } })
   .composite([{
     input: { create: { width: 260, height: 16, channels: 3, background: '#121c30' } },
     left: box.left + 30, top: box.top + 20,
   }]).png().toBuffer();
 const { overlay } = await composeReelsScene(photo, fitted, undefined, cendekiaPalette);
 const scale = 720 / 1080;
 const alphaIn = async (left: number, top: number, width: number, height: number) =>
   sharp(overlay).extract({
     left: Math.floor(left * scale), top: Math.floor(top * scale),
     width: Math.floor(width * scale), height: Math.floor(height * scale),
   }).extractChannel('alpha').raw().toBuffer();
 assert.ok((await alphaIn(box.left, box.top, box.width, 37)).every(alpha => alpha === 0),
   'the original headline position stays empty');
 const { data, info } = await sharp(overlay).extract({
   left: Math.floor(box.left * scale), top: Math.floor((box.top + 37) * scale),
   width: Math.floor(box.width * scale), height: Math.ceil((box.height + 130) * scale),
 }).raw().toBuffer({ resolveWithObject: true });
 let lastTextRow = -1;
 let firstAccentRow = info.height;
 for (let offset = 0; offset < data.length; offset += 4) {
   if (data[offset + 3] < 245) continue;
   const row = Math.floor(offset / (info.width * 4));
   if (data[offset] < 45 && data[offset + 2] >= 115) lastTextRow = Math.max(lastTextRow, row);
   if (data[offset] > 230 && data[offset + 1] > 160 && data[offset + 2] < 25) {
     firstAccentRow = Math.min(firstAccentRow, row);
   }
 }
 assert.ok(lastTextRow > 0, 'the headline is readable in nearby quiet space');
 assert.ok(firstAccentRow > lastTextRow && firstAccentRow < info.height,
   'the underline follows the repositioned headline');
});

test('Reels footer fallback leaves supporting copy clear and refuses an overcrowded upper area', async () => {
 const copy = {
   businessName: 'Berez ERP', headline: 'Dalam Satu Sistem',
   supporting: 'Penjualan dan persediaan.',
   cta: 'Pelajari selengkapnya', website: 'berez.dafinicode.com',
 };
 const { fitted, captionLines } = await prepareScheduledReelsCopy(copy, false);
 assert.deepEqual(captionLines, []);
 const headline = fitted.find(({ key }) => key === 'headline');
 const support = fitted.find(({ key }) => key === 'supporting');
 const cta = fitted.find(({ key }) => key === 'cta');
 const website = fitted.find(({ key }) => key === 'website');
 assert.ok(headline && support && cta && website);
 // Keep real glyph masks, but control geometry independently of platform font
 // wrapping. This is a placement regression, not another text-fitting test.
 headline.box.top = 664 - headline.box.height;
 support.box.top = 840 - support.box.height;
 cta.box.top = 1386;
 website.box.top = 1478;

 // The upper natural surface is quiet, but lower detail makes the original footer
 // unreadable. The compositor must relocate it without writing over narration.
 const size = { width: 1080, height: 1920 };
 const pixels = Buffer.alloc(size.width * size.height * 3, 240);
 for (let y = 1200; y < size.height; y++) {
   for (let x = 0; x < size.width; x++) {
     const value = Math.floor(x / 90) % 2 * 255;
     const offset = (y * size.width + x) * 3;
     pixels.fill(value, offset, offset + 3);
   }
 }
 const photo = await sharp(pixels, { raw: { ...size, channels: 3 } }).png().toBuffer();
 const { overlay } = await composeReelsScene(photo, fitted, undefined, cendekiaPalette, 3);
 const scale = 720 / 1080;
 const alphaIn = (top: number, height: number, width = 810) => sharp(overlay).extract({
   left: Math.floor(support.box.left * scale), top: Math.ceil(top * scale),
   width: Math.floor(width * scale), height: Math.floor(height * scale),
 }).extractChannel('alpha').raw().toBuffer();
 const supportBottom = support.box.top + support.box.height;
 const footerTop = supportBottom + 28;
 assert.ok((await alphaIn(supportBottom + 4, 20)).every(alpha => alpha === 0),
   'the gap after narration must remain clear of CTA and domain glyphs');
 assert.ok((await alphaIn(footerTop, cta.box.height, cta.box.width)).some(alpha => alpha > 230),
   'CTA follows the whole supporting paragraph');
 const websiteTop = footerTop + website.box.top - cta.box.top;
 assert.ok((await alphaIn(websiteTop, website.box.height, website.box.width)).some(alpha => alpha > 230),
   'domain remains a separate line below CTA');
 assert.ok(websiteTop + website.box.height <= 1028, 'the entire closing copy fits above the screenshot area');
 assert.ok((await alphaIn(1038, 560)).every(alpha => alpha === 0),
   'fallback leaves the screenshot and lower footer regions clear');

 const crowded = fitted.map(block => block.key === 'supporting'
   ? { ...block, box: { ...block.box, top: 1000 - block.box.height } }
   : block);
 await assert.rejects(composeReelsScene(photo, crowded, undefined, cendekiaPalette, 3),
   { code: 'reels_photo_layout_unreadable' },
   'an unreadable footer cannot be rescued by overlapping copy or entering the screenshot area');
});

test('Reels corner accents leave the photo and original logo clear above the corners', async () => {
 const logo = { id: 'logo', role: 'logo' as const, bytes: await pixelSource(160, 80) };
 const plain = await composeReelsOriginalOverlay([logo]);
 const editorial = await composeReelsOriginalOverlay([logo], cendekiaPalette);
 assert.ok(plain && editorial);
 const { data, info } = await sharp(editorial).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
 const original = await sharp(plain).ensureAlpha().raw().toBuffer();
 let lowerLeft = 0;
 let lowerRight = 0;
 for (let y = 0; y < info.height; y++) {
   for (let x = 0; x < info.width; x++) {
     const offset = (y * info.width + x) * info.channels;
     if (data.readUInt32BE(offset) === original.readUInt32BE(offset)) continue;
     assert.ok(y >= info.height - 108, 'no decorative pixels above the bottom corner zone');
     if (x >= info.width / 3 && x <= info.width * 2 / 3) {
       assert.ok(y >= info.height - 20, 'only the tips of the accents can reach the center');
     }
     if (x < info.width / 2) lowerLeft++;
     else lowerRight++;
   }
 }
 assert.ok(lowerLeft > 500 && lowerRight > 500);
 assert.ok(lowerLeft + lowerRight < info.width * info.height * 0.05,
   'corner accents occupy only a small part of the video');
});


test('photography fills the canvas outside original artwork and text, without opaque white bands',async()=>{
 const scenes=await Promise.all(['#E711B1','#11E741'].map(background=>sharp({create:{width:1080,height:1920,channels:3,background}}).jpeg().toBuffer()));
 for(const aspectRatio of ['4:5','9:16'] as const){const outputs=await Promise.all(scenes.map(scene=>composeSocialVisual(scene,{...params,aspectRatio}).then(output=>sharp(output).removeAlpha().raw().toBuffer({resolveWithObject:true}))));const[{data,info},other]=outputs;
  for(const[x,y]of [[16,16],[1060,16],[16,info.height-16],[1060,info.height-16],[1030,Math.floor(info.height/2)]]){const offset=(y*info.width+x)*info.channels;const pixel=data.subarray(offset,offset+3);assert.ok(pixel.some((value,index)=>Math.abs(value-other.data[offset+index])>8),'photo changes must remain visible outside artwork, even under shading');assert.ok(pixel.some(value=>value<245),'no blank white canvas panel');}
 }
});

test('explicit roles reject foreign keys, invalid roles and duplicate protected materials; never infer names',()=>{
 assert.deepEqual(resolveReferenceRoles(['a','b']),{a:'visual',b:'visual'});
 for(const roles of [{foreign:'logo'},{a:'unknown'},{a:'logo',b:'logo'},{a:'screenshot',b:'screenshot'}])assert.throws(()=>resolveReferenceRoles(['a','b'],roles as never));
 assert.deepEqual(resolveReferenceRoles(['a','b','c'],{a:'visual',b:'screenshot',c:'logo'}),{a:'visual',b:'screenshot',c:'logo'});
});
test('original logo and complete screenshot pixels survive all PNG compositions without crop or repaint',async()=>{
 const logo=await pixelSource(160,80),screen=await pixelSource(320,180);const scene=await sharp({create:{width:1080,height:1350,channels:3,background:'#bacbd7'}}).jpeg().toBuffer();
 for(const vertical of [false,true]){
  const output=await composeSocialVisual(scene,{...params,aspectRatio:vertical?'9:16':'4:5',originalAssets:[{id:'logo',role:'logo',bytes:logo},{id:'screen',role:'screenshot',bytes:screen}]});
  const layout=compositionLayout(vertical,true);const meta=await sharp(output).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,vertical?1920:1350);
  for(const [source,box,w,h] of [[logo,{left:48,top:layout.brand.top,width:180,height:96},160,80],[screen,layout.screen,320,180]] as const){
   const actual=await sharp(output).extract({left:box.left+Math.floor((box.width-w)/2),top:box.top+Math.floor((box.height-h)/2),width:w,height:h}).removeAlpha().raw().toBuffer();
   const expected=await sharp(source).removeAlpha().raw().toBuffer();assert.deepEqual(actual,expected);
  }
 }
});
test('carousel keeps copy below the photograph, preserves the selected screenshot and adds CTA only at the end', async () => {
 const scene = await sharp({create:{width:1080,height:1350,channels:3,background:'#657F93'}}).png().toBuffer();
 const screenshot = await pixelSource(320,180);
 const content = {...params,carouselSlide:true,cta:'',originalAssets:[{id:'screen',role:'screenshot' as const,bytes:screenshot}]};
 const copy = await renderCompositionText(content);
 const first = await composeSocialVisual(scene, content);
 const final = {...content,cta:'Pelajari selengkapnya'};
 const last = await composeSocialVisual(scene, final);
 async function pixels(image: Buffer,left: number,top: number,width=1,height=1) {
  return sharp(image).extract({left,top,width,height}).removeAlpha().raw().toBuffer();
 }
 for (const [x,y] of [[10,20],[930,360],[96,500],[64,copy.heroHeight-1]]) {
  assert.deepEqual(await pixels(first,x,y), await pixels(scene,x,y));
 }
 assert.deepEqual(await pixels(first,10,copy.heroHeight),Buffer.from([246,248,251]));
 const left=500+(520-320)/2;
 const top=copy.heroHeight-248+(210-180)/2;
 assert.deepEqual(await pixels(first,left,top,320,180),await pixels(screenshot,0,0,320,180));
 assert.ok(!copy.cta && !copy.site);
 const finalCopy = await renderCompositionText(final);
 assert.ok(finalCopy.cta && finalCopy.site);
 const footerBottom=finalCopy.supportingTop+finalCopy.supporting!.height+26+finalCopy.cta.height+12+finalCopy.site.height;
 assert.ok(footerBottom<=1300);
 assert.deepEqual(await pixels(last,80,finalCopy.heroHeight+35),Buffer.from([0,97,173]));
});

test('editorial carousel overlays only the requested original assets and preserves the full composition',async()=>{
 const artwork=await sharp({create:{width:1080,height:1350,channels:3,background:'#8AAA76'}}).png().toBuffer();
 const logo=await sharp({create:{width:160,height:80,channels:3,background:'#005CAD'}}).png().toBuffer();
 const screenshot=await sharp({create:{width:320,height:180,channels:3,background:'#B2E0F3'}}).png().toBuffer();
 const output=await finishEditorialCarousel(artwork,[{id:'logo',role:'logo',bytes:logo},{id:'screen',role:'screenshot',bytes:screenshot}]);
 const pixel=async(image:Buffer,left:number,top:number)=>sharp(image).extract({left,top,width:1,height:1}).removeAlpha().raw().toBuffer();
 const base=await finishEditorialCarousel(artwork,[]);
 for(const [x,y] of [[550,80],[90,550],[600,1230],[1050,1320]])assert.deepEqual(await pixel(output,x,y),await pixel(base,x,y));
 for(const [role,input] of [['logo',logo],['screenshot',screenshot]] as const){
  const rect=CAROUSEL_ARTWORK[role];
  const actual=await pixel(output,rect.left+rect.width/2,rect.top+rect.height/2);
  const expected=await pixel(input,0,0);
  assert.ok(actual.every((value,index)=>Math.abs(value-expected[index])<=4));
 }
});

test('protected screenshots fit proportionally with every edge preserved and text markup escaped',async()=>{
 const screenshot=await pixelSource(1000,500);const scene=await pixelSource(300,400);const output=await composeSocialVisual(scene,{...params,title:'Berez <ERP> & “Bisnis”',brandPalette:['#FFFFFF','#0061AD'],originalAssets:[{id:'screen',role:'screenshot',bytes:screenshot}]});
 const box=compositionLayout(false,true).screen;const fitted=await sharp(screenshot).resize(box.width,box.height,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
 const actual=await sharp(output).extract({left:box.left+Math.floor((box.width-fitted.info.width)/2),top:box.top+Math.floor((box.height-fitted.info.height)/2),width:fitted.info.width,height:fitted.info.height}).removeAlpha().raw().toBuffer();assert.deepEqual(actual,await sharp(fitted.data).removeAlpha().raw().toBuffer());
 assert.equal(shortVisualCta('x'.repeat(100)),'Pelajari selengkapnya');assert.equal(visualWebsite(params.websiteUrl),'berez.dafinicode.com');assert.equal(visualWebsite('javascript:bad'),'');
 await assert.rejects(composeSocialVisual(scene,{...params,brandPalette:['bad']}));
});
