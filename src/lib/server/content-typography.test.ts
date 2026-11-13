import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CONTENT_TYPOGRAPHY } from '../content-typography';
import { composeSocialVisual, compositionLayout, fitCompositionText, preflightSocialVisualText, renderCompositionText } from './content-compositor';

const copy={businessName:'Cendekia AI',title:'Pabrik Soal TKA di Sekolah?',hook:'Dukung persiapan TKA sekolah dengan pembuatan bank soal otomatis dan tryout dari Cendekia AI.',cta:'Pelajari selengkapnya',websiteUrl:'https://cendekia.dafinicode.com'};

test('actual raster text stays readable at phone width and within its reserved boxes',async()=>{
 const layout=compositionLayout(false,false);
 const {supporting, supportingTop, cta, site}=await renderCompositionText(copy);
 assert.ok(supporting);assert.ok(supporting.fontSize*390/1080>=15);
 assert.ok(supporting.width<=layout.subtitle.width);
 assert.ok(supportingTop+supporting.height<=layout.screen.top-32);
 assert.ok(cta);assert.ok(cta.fontSize>=CONTENT_TYPOGRAPHY.cta.min);assert.ok(cta.height<=64);
 assert.ok(site);assert.ok(site.fontSize>=CONTENT_TYPOGRAPHY.website.min);assert.ok(site.height<=52);
});

test('overflow fails explicitly instead of truncating facts or shrinking to illegible sizes',async()=>{
 const box=compositionLayout(false,false).subtitle;
 await assert.rejects(fitCompositionText('Informasi penting 123 '.repeat(30),box.width,box.height,46,42,'#FFFFFF'),error=>(error as {code?:string}).code==='visual_composition_invalid');
});

test('feed and Reels text, protected screenshot, and footer have separate bounds and Reels UI clearance',()=>{
 for(const vertical of [false,true]){const layout=compositionLayout(vertical,true);assert.ok(layout.title.top+layout.title.height<(vertical?layout.screen.top:layout.subtitle.top));if(!vertical)assert.ok(layout.subtitle.top+layout.subtitle.height<layout.screen.top-12);assert.ok(layout.screen.top+layout.screen.height+12<layout.footer.top);assert.ok(layout.footer.top+layout.footer.height<=layout.height-(vertical?320:48));}
});

test('4:5 reflows long Indonesian copy that overflows the old boxes without shrinking or covering the screenshot',async()=>{
 const screenshot=await sharp({create:{width:240,height:160,channels:3,background:'#E120A0'}}).png().toBuffer();
 const scene=await sharp({create:{width:1080,height:1350,channels:3,background:'#09202F'}}).png().toBuffer();
 const layout=compositionLayout(false,true);
 const cases=[
  {...copy,title:'Persiapan Menghadapi Ujian dengan Pembelajaran dan Kedisiplinan',hook:'Mulai dari satu sesi belajar.'},
  {...copy,title:'Tinjau hasil latihan',hook:'Pemantauan perkembangan membantu mengidentifikasi kelemahan pembelajaran dan merencanakan pembahasan berikutnya.'},
 ];
 await assert.rejects(fitCompositionText(cases[0].title,640,252,80,64,'#FFFFFF',true));
 await assert.rejects(fitCompositionText(cases[1].hook,640,228,46,42,'#FFFFFF'));
 for(const content of cases){
  const params={...content,originalAssets:[{id:'test-screen',role:'screenshot' as const,bytes:screenshot}]};
  await preflightSocialVisualText(params);
  const {headline,supporting,supportingTop}=await renderCompositionText(params);
  assert.ok(headline&&supporting);
  assert.ok(headline.fontSize>=CONTENT_TYPOGRAPHY.feedTitle.min&&supporting.fontSize>=CONTENT_TYPOGRAPHY.body.min);
  assert.ok(supportingTop-(layout.title.top+headline.height)>=24);
  assert.ok(supportingTop+supporting.height<=layout.screen.top-32);
  const result=await composeSocialVisual(scene,params);
  const screenPixels=await sharp(result).extract({left:layout.screen.left+(layout.screen.width-240)/2,top:layout.screen.top+(layout.screen.height-160)/2,width:240,height:160}).removeAlpha().raw().toBuffer();
  assert.deepEqual(screenPixels,await sharp(screenshot).removeAlpha().raw().toBuffer());
 }
 await assert.rejects(preflightSocialVisualText({...copy,hook:'Informasi penting 123 '.repeat(23)}),error=>(error as {code?:string}).code==='visual_composition_invalid');
});

test('white copy has at least 4.5 to 1 contrast over the brightest possible photo',async()=>{
 const scene=await sharp({create:{width:1080,height:1350,channels:3,background:'#FFFFFF'}}).png().toBuffer();
 const output=await composeSocialVisual(scene,{...copy,title:'X',hook:'X'});
 const{data}=await sharp(output).extract({left:680,top:680,width:1,height:1}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const linear=[...data].map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});const luminance=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
 assert.ok(1.05/(luminance+.05)>=4.5);
});
