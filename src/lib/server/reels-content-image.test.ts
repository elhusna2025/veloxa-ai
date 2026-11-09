import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generateSocialPostImage } from './content-image';
test('Reels scene requests portrait Sunburst with supplied subject and yields JPEG720x1280',async()=>{
  const source=await sharp({create:{width:720,height:1280,channels:3,background:'#eeeeee'}}).jpeg().toBuffer();let request:Record<string,unknown>|undefined;
  const imageClient={images:{generate:async(p:Record<string,unknown>)=>{request=p;return{data:[{b64_json:source.toString('base64')}]};}}};
  const image=await generateSocialPostImage({businessName:'Brand',title:'Satu langkah',hook:'Coba latihan terarah.',cta:'Simpan',aspectRatio:'9:16',visualDirection:'Pelajar berlatih dengan catatan.'},{imageClient});
  assert.equal(request?.model,'gpt-image-2.5-sunburst');assert.equal(request?.size,'1008x1792');assert.match(String(request?.prompt),/Pelajar berlatih dengan catatan/);const metadata=await sharp(image).metadata();assert.equal(metadata.width,720);assert.equal(metadata.height,1280);assert.equal(metadata.format,'jpeg');
});
