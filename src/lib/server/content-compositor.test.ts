import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { composeSocialVisual, compositionLayout, renderCompositionText, shortVisualCta, visualWebsite } from './content-compositor';
import { resolveReferenceRoles } from '../content-reference-roles';
const params={businessName:'Berez ERP',title:'Penjualan & Stok Lebih Terpantau',hook:'Kelola transaksi dan persediaan dalam satu sistem.',cta:'Kenali Berez ERP',websiteUrl:'https://berez.dafinicode.com/',brandPalette:['#0061AD','#FFFFFF']};
async function pixelSource(width:number,height:number){const data=Buffer.alloc(width*height*3);for(let i=0;i<data.length;i++)data[i]=(i*29+47)%256;return sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();}

test('bundled font renders readable Latin copy without any installed system fonts',async()=>{
 const{mkdtemp,writeFile,rm,mkdir}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const path=await import('node:path');const{execFile}=await import('node:child_process');const{promisify}=await import('node:util');const dir=await mkdtemp(path.join(tmpdir(),'veloxa-isolated-font-'));
 try{await mkdir(path.join(dir,'empty'));const config=path.join(dir,'fonts.conf');await writeFile(config,`<?xml version="1.0"?><fontconfig><dir>${dir}/empty</dir><cachedir>${dir}/cache</cachedir></fontconfig>`);
  const script=`import sharp from 'sharp';import assert from 'node:assert/strict';import{composeSocialVisual,compositionLayout}from './src/lib/server/content-compositor.ts';const scene=await sharp({create:{width:1080,height:1350,channels:3,background:'#000000'}}).jpeg().toBuffer();const output=await composeSocialVisual(scene,${JSON.stringify(params)});const box=compositionLayout(false,false).title;const rendered=await sharp(output).extract(box).threshold(230).trim({background:'#000000'}).png().toBuffer({resolveWithObject:true});assert.ok(rendered.info.width>400,'Latin headline must not degrade into narrow missing-glyph boxes');assert.ok(rendered.info.height>55,'Latin headline must retain its intended font size');`;
  await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,FONTCONFIG_FILE:config,FONTCONFIG_PATH:dir},timeout:30000});
 }finally{await rm(dir,{recursive:true,force:true});}
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

test('protected screenshots fit proportionally with every edge preserved and text markup escaped',async()=>{
 const screenshot=await pixelSource(1000,500);const scene=await pixelSource(300,400);const output=await composeSocialVisual(scene,{...params,title:'Berez <ERP> & “Bisnis”',brandPalette:['#FFFFFF','#0061AD'],originalAssets:[{id:'screen',role:'screenshot',bytes:screenshot}]});
 const box=compositionLayout(false,true).screen;const fitted=await sharp(screenshot).resize(box.width,box.height,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
 const actual=await sharp(output).extract({left:box.left+Math.floor((box.width-fitted.info.width)/2),top:box.top+Math.floor((box.height-fitted.info.height)/2),width:fitted.info.width,height:fitted.info.height}).removeAlpha().raw().toBuffer();assert.deepEqual(actual,await sharp(fitted.data).removeAlpha().raw().toBuffer());
 assert.equal(shortVisualCta('x'.repeat(100)),'Pelajari selengkapnya');assert.equal(visualWebsite(params.websiteUrl),'berez.dafinicode.com');assert.equal(visualWebsite('javascript:bad'),'');
 await assert.rejects(composeSocialVisual(scene,{...params,brandPalette:['bad']}));
});
