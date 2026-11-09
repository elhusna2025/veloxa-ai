import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_PRESETS } from './veloxa-engine';
import { normalizeBrandProfile } from './veloxa-brand-profile';
import { savedBrandPalette, normalizeBrandHex } from './brand-visual-dna';
test('DNA opt-in preserves legacy palettes and all business data; normalized explicit colors are bounded',()=>{
 const brand={...BRAND_PRESETS.custom,workspaceId:'workspace-a'};
 assert.deepEqual(savedBrandPalette(brand),[]);
 const next=normalizeBrandProfile({...brand,useBrandPalette:true,primaryColorHex:'#167d8d',accentColorHex:'#abcdef',additionalColorHexes:['#123456','#123456','#abcdef']});
 assert.equal(next.primaryColorHex,'#167D8D');assert.deepEqual(savedBrandPalette(next),['#167D8D','#ABCDEF','#123456']);assert.deepEqual(next.offerings,brand.offerings);assert.equal(next.workspaceId,brand.workspaceId);
 assert.deepEqual(savedBrandPalette({...next,useBrandPalette:false}),[]);assert.equal(normalizeBrandHex(' #abcdef '),'#ABCDEF');
 assert.throws(()=>normalizeBrandProfile({...brand,useBrandPalette:true,accentColorHex:'url(private)'}),/HEX/);
 assert.throws(()=>normalizeBrandProfile({...brand,useBrandPalette:true,additionalColorHexes:Array(5).fill('#FFFFFF')}),/empat/);
 assert.throws(()=>normalizeBrandProfile({...brand,logoAssetId:'https://example.test/foreign.jpg'}),/Foto brand/);
});
