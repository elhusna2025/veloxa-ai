import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CAROUSEL_ARTWORK, REELS_ACCENT, REELS_ARTWORK, composeReelsScene, composeSocialVisual, finishEditorialCarousel, compositionLayout, prepareReelsCopyBatch, renderCompositionText, shortVisualCta, visualWebsite } from './content-compositor';
import { resolveReferenceRoles } from '../content-reference-roles';
import { CONTENT_TYPOGRAPHY } from '../content-typography';
const params={businessName:'Berez ERP',title:'Penjualan & Stok Lebih Terpantau',hook:'Kelola transaksi dan persediaan dalam satu sistem.',cta:'Kenali Berez ERP',websiteUrl:'https://berez.dafinicode.com/',brandPalette:['#0061AD','#FFFFFF']};
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

test('Reels scenes use one headline size and the same safe accent position across different photo tones', async () => {
 const copies = [
   { headline: 'Kenapa Jawabanku Salah?', cta: '', website: '' },
   { headline: 'Tandai langkah pertama', cta: '', website: '' },
   { headline: 'Pahami kesalahan sebelum mengulang latihan', cta: '', website: '' },
   { headline: 'Coba satu soal serupa', cta: 'Pelajari selengkapnya', website: 'cendekiaai.com' },
 ].map(copy => ({ businessName: 'Cendekia AI', ...copy }));
 const prepared = await prepareReelsCopyBatch(copies, true);
 assert.equal(prepared.length, 4);
 const sizes = new Set<number>();
 for (const { fitted, captionLines } of prepared) {
   assert.deepEqual(captionLines, []);
   const headline = fitted.find(({ key }) => key === 'headline');
   assert.ok(headline);
   sizes.add(headline.text.fontSize);
   assert.equal(headline.box.left, prepared[0].fitted.find(({ key }) => key === 'headline')!.box.left);
   assert.equal(headline.box.top, prepared[0].fitted.find(({ key }) => key === 'headline')!.box.top);
   assert.ok(headline.box.top >= REELS_ACCENT.top + REELS_ACCENT.height);
   assert.ok(headline.box.top + headline.box.height < REELS_ARTWORK.screenshot.top);
   for (const { box } of fitted) {
     assert.ok(box.left >= 0 && box.left + box.width <= 1080);
     assert.ok(box.top >= 224 && box.top + box.height <= 1600);
   }
 }
 assert.equal(sizes.size, 1);
 assert.ok([...sizes][0] >= CONTENT_TYPOGRAPHY.reelsTitle.min);
 const wideCopy = { ...copies[2], headline: Array(7).fill('WWWWWW').join(' ') };
 const constrained = await prepareReelsCopyBatch([copies[0], wideCopy], true);
 const constrainedSizes = constrained.map(({ fitted }) => fitted.find(({ key }) => key === 'headline')?.text.fontSize);
 assert.ok(constrainedSizes[0] && constrainedSizes[0] < CONTENT_TYPOGRAPHY.reelsTitle.max);
 assert.equal(constrainedSizes[0], constrainedSizes[1], 'a tighter title adjusts the entire set');

 const brandPalette = ['#F3EEE4', '#123B60'];
 const backgrounds = ['#F3EEE4', '#FAF8F2', '#131C25', '#F8E9D3'];
 const frames = await Promise.all(prepared.map(async ({ fitted }, index) => {
   const photo = await sharp({
     create: { width: 1080, height: 1920, channels: 3, background: backgrounds[index] },
   }).png().toBuffer();
   return composeReelsScene(photo, fitted, undefined, brandPalette);
 }));
 const outputScale = 720 / 1080;
 const accentPixel = {
   left: Math.round((REELS_ACCENT.left + REELS_ACCENT.width / 2) * outputScale),
   top: Math.round((REELS_ACCENT.top + REELS_ACCENT.height / 2) * outputScale),
   width: 1,
   height: 1,
 };
 for (const [index, { overlay }] of frames.entries()) {
   const actual = await sharp(overlay).extract(accentPixel).raw().toBuffer();
   assert.ok(actual[3] > 240, 'accent remains visible against the photo');
   const expected = index === 2 ? [0xF3, 0xEE, 0xE4] : [0x12, 0x3B, 0x60];
   assert.ok(expected.every((channel, i) => Math.abs(channel - actual[i]) <= 4),
     'accent selects the first sufficiently contrasting brand color');
   const headline = prepared[index].fitted.find(({ key }) => key === 'headline')!;
   const ink = await sharp(overlay).extract({
     left: Math.ceil(headline.box.left * outputScale),
     top: Math.ceil(headline.box.top * outputScale),
     width: Math.floor(headline.box.width * outputScale) - 2,
     height: Math.floor(headline.box.height * outputScale) - 2,
   }).raw().toBuffer();
   const visibleGlyph = ink.findIndex((value, offset) => offset % 4 === 3 && value >= 245) - 3;
   assert.ok(visibleGlyph >= 0);
   assert.ok(index === 2 ? ink[visibleGlyph] >= 240 : ink[visibleGlyph] <= 30,
     'headline keeps high contrast on the current photo');
 }
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
