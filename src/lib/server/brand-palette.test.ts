import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { analyzeBrandLogo, extractLogoPalette } from './brand-palette';
import { ApiError } from './http';
const id='123e4567-e89b-42d3-a456-426614174000';
async function logo(){return sharp(Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="white"/><rect x="10" y="10" width="60" height="70" fill="#167D8D"/><rect x="70" y="10" width="20" height="70" fill="#FF0000"/></svg>')).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();}
function request(workspaceId='workspace-a',assetId=id){return new Request('http://localhost/api/veloxa/brand/palette',{method:'POST',body:JSON.stringify({workspaceId,assetId})});}
test('logo sample finds saturated colors, ignores white background, handles monochrome, bounds outputs and rejects corrupt bytes',async()=>{
 const colors=await extractLogoPalette(await logo());assert.ok(colors.length>=2&&colors.length<=6);assert.ok(colors.every(color=>/^#[0-9A-F]{6}$/.test(color)));assert.ok(!colors.includes('#FFFFFF'));assert.ok(colors.some(color=>parseInt(color.slice(1,3),16)>230));
 const gray=await sharp({create:{width:20,height:20,channels:3,background:'#777777'}}).jpeg().toBuffer();assert.deepEqual(await extractLogoPalette(gray),['#777777']);
 await assert.rejects(extractLogoPalette(Buffer.from('bad')),error=>error instanceof ApiError&&error.status===400);
});
test('logo identity is stable across inverse blue and white marks and transparent backgrounds',async()=>{
 const blueOnWhite=Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="white"/><rect x="20" y="20" width="60" height="60" fill="#167D8D"/></svg>');
 const whiteOnBlue=Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="#167D8D"/><rect x="20" y="20" width="60" height="60" fill="white"/></svg>');
 const transparent=Buffer.from('<svg width="100" height="100"><rect x="20" y="20" width="60" height="60" fill="#167D8D"/></svg>');
 const [lightPalette,darkPalette,transparentPalette]=await Promise.all([blueOnWhite,whiteOnBlue,transparent].map(async svg=>extractLogoPalette(await sharp(svg).png().toBuffer())));
 assert.equal(lightPalette[0],darkPalette[0]);assert.equal(lightPalette[0],transparentPalette[0]);
});
test('logo analysis authorizes workspace, enforces active owned asset and uses bounded private reads without writes',async()=>{
 const bytes=await logo();let downloads=0;let lastRange:unknown;let record:any={storagePath:`workspaces/workspace-a/vault/${id}.jpg`,asset:{id,workspaceId:'workspace-a',drawer:'real_asset',mediaType:'photo',title:'Logo'}};
 const ref={collection:(name:string)=>{assert.equal(name,'server_assets');return{doc:(assetId:string)=>{assert.equal(assetId,id);return{get:async()=>({data:()=>record})};}};}};
 const authorize=async(_request:Request,workspaceId:unknown)=>{if(workspaceId!=='workspace-a')throw new ApiError(403,'Forbidden');return{ref,workspaceId:'workspace-a'};};
 const storage={file:(path:string)=>{assert.equal(path,`workspaces/workspace-a/vault/${id}.jpg`);return{download:async(range:unknown)=>{downloads++;lastRange=range;return[bytes];}};}};
 const deps={authorize:authorize as never,storage:storage as never};
 assert.ok((await analyzeBrandLogo(request(),deps)).colors.length);assert.deepEqual(lastRange,{start:0,end:4*1024*1024});
 await assert.rejects(analyzeBrandLogo(request('workspace-b'),deps),error=>error instanceof ApiError&&error.status===403);assert.equal(downloads,1);
 record={...record,trashedAt:'2026-11-10'};await assert.rejects(analyzeBrandLogo(request(),deps),error=>error instanceof ApiError&&error.status===404);assert.equal(downloads,1);
 record={...record,trashedAt:undefined,storagePath:`workspaces/foreign/vault/${id}.jpg`};await assert.rejects(analyzeBrandLogo(request(),deps),error=>error instanceof ApiError&&error.status===404);assert.equal(downloads,1);
 await assert.rejects(analyzeBrandLogo(request('workspace-a','https://example.test/logo.jpg'),deps));
});
