import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CONTENT_TYPOGRAPHY } from '../content-typography';
import { composeSocialVisual, compositionLayout, fitCompositionText } from './content-compositor';

const copy={businessName:'Cendekia AI',title:'Pabrik Soal TKA di Sekolah?',hook:'Dukung persiapan TKA sekolah dengan pembuatan bank soal otomatis dan tryout dari Cendekia AI.',cta:'Pelajari selengkapnya',websiteUrl:'https://cendekia.dafinicode.com'};

test('actual raster text stays readable at phone width and within its reserved boxes',async()=>{
 const box=compositionLayout(false,false).subtitle;
 const body=await fitCompositionText(copy.hook,box.width,box.height,CONTENT_TYPOGRAPHY.body.max,CONTENT_TYPOGRAPHY.body.min,'#FFFFFF');
 assert.ok(body);assert.ok(body.fontSize*390/1080>=15);assert.ok(body.height<=box.height);assert.ok(body.width<=box.width);
 const footer=compositionLayout(false,false).footer;
 for(const[text,style,height]of [[copy.cta,CONTENT_TYPOGRAPHY.cta,64],['cendekia.dafinicode.com',CONTENT_TYPOGRAPHY.website,52]]as const){const rendered=await fitCompositionText(text,footer.width-64,height,style.max,style.min,'#FFFFFF');assert.ok(rendered);assert.ok(rendered.fontSize>=style.min);assert.ok(rendered.height<=height);}
});

test('overflow fails explicitly instead of truncating facts or shrinking to illegible sizes',async()=>{
 const box=compositionLayout(false,false).subtitle;
 await assert.rejects(fitCompositionText('Informasi penting 123 '.repeat(30),box.width,box.height,46,42,'#FFFFFF'),error=>(error as {code?:string}).code==='visual_composition_invalid');
});

test('feed and Reels text, protected screenshot, and footer have separate bounds and Reels UI clearance',()=>{
 for(const vertical of [false,true]){const layout=compositionLayout(vertical,true);assert.ok(layout.title.top+layout.title.height<(vertical?layout.screen.top:layout.subtitle.top));if(!vertical)assert.ok(layout.subtitle.top+layout.subtitle.height<layout.screen.top-12);assert.ok(layout.screen.top+layout.screen.height+12<layout.footer.top);assert.ok(layout.footer.top+layout.footer.height<=layout.height-(vertical?320:48));}
});

test('white copy has at least 4.5 to 1 contrast over the brightest possible photo',async()=>{
 const scene=await sharp({create:{width:1080,height:1350,channels:3,background:'#FFFFFF'}}).png().toBuffer();
 const output=await composeSocialVisual(scene,{...copy,title:'X',hook:'X'});
 const{data}=await sharp(output).extract({left:680,top:680,width:1,height:1}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const linear=[...data].map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});const luminance=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
 assert.ok(1.05/(luminance+.05)>=4.5);
});
