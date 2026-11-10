import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { composeSocialVisual, compositionLayout, shortVisualCta, visualWebsite } from './content-compositor';
import { resolveReferenceRoles } from '../content-reference-roles';
const params={businessName:'Berez ERP',title:'Penjualan & Stok Lebih Terpantau',hook:'Kelola transaksi dan persediaan dalam satu sistem.',cta:'Kenali Berez ERP',websiteUrl:'https://berez.dafinicode.com/',brandPalette:['#0061AD','#FFFFFF']};
async function pixelSource(width:number,height:number){const data=Buffer.alloc(width*height*3);for(let i=0;i<data.length;i++)data[i]=(i*29+47)%256;return sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();}
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
test('protected screenshots fit proportionally with every edge preserved and text markup escaped',async()=>{
 const screenshot=await pixelSource(1000,500);const scene=await pixelSource(300,400);const output=await composeSocialVisual(scene,{...params,title:'Berez <ERP> & “Bisnis”',brandPalette:['#FFFFFF','#0061AD'],originalAssets:[{id:'screen',role:'screenshot',bytes:screenshot}]});
 const box=compositionLayout(false,true).screen;const fitted=await sharp(screenshot).resize(box.width,box.height,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
 const actual=await sharp(output).extract({left:box.left+Math.floor((box.width-fitted.info.width)/2),top:box.top+Math.floor((box.height-fitted.info.height)/2),width:fitted.info.width,height:fitted.info.height}).removeAlpha().raw().toBuffer();assert.deepEqual(actual,await sharp(fitted.data).removeAlpha().raw().toBuffer());
 assert.equal(shortVisualCta('x'.repeat(100)),'Pelajari selengkapnya');assert.equal(visualWebsite(params.websiteUrl),'berez.dafinicode.com');assert.equal(visualWebsite('javascript:bad'),'');
 await assert.rejects(composeSocialVisual(scene,{...params,brandPalette:['bad']}));
});
