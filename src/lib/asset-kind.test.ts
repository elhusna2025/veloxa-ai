import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAssetKind,assetKindLabel,assetMetadataRevision} from './asset-kind';
import {canAutoFillFirstLogo,logoPalettePatch,paletteFingerprint} from './logo-palette-proposal';
import {BRAND_PRESETS} from './veloxa-engine';
const id='123e4567-e89b-42d3-a456-426614174000';
test('asset categories preserve custom names, reject malformed kinds and safely read legacy assets',()=>{
 assert.deepEqual(parseAssetKind({category:'other',customCategoryLabel:'  Foto sertifikat  '}),{category:'other',customCategoryLabel:'Foto sertifikat'});
 assert.equal(assetKindLabel({category:'logo'}),'Logo');assert.equal(assetKindLabel({}),'Belum dikategorikan');
 for(const raw of[{category:'unknown'},{category:'other'},{category:'other',customCategoryLabel:'x'.repeat(81)}])assert.throws(()=>parseAssetKind(raw));
 assert.equal(assetMetadataRevision(undefined),0);assert.equal(assetMetadataRevision(3),3);
 for(const raw of[-1,'1',NaN,Number.MAX_SAFE_INTEGER])assert.throws(()=>assetMetadataRevision(raw));
});
test('only untouched first-logo forms auto-fill; saved and manually edited palettes require review',()=>{
 const saved={...BRAND_PRESETS.cafe_fnb,logoAssetId:undefined,useBrandPalette:false,paletteMode:undefined};
 assert.equal(canAutoFillFirstLogo(saved,{...saved}),true);
 assert.equal(canAutoFillFirstLogo(saved,{...saved,paletteMode:'manual'}),false);
 assert.equal(canAutoFillFirstLogo(saved,{...saved,primaryColorHex:'#0061AD'}),false);
 assert.equal(canAutoFillFirstLogo({...saved,logoAssetId:id},{...saved,logoAssetId:id}),false);
 assert.equal(canAutoFillFirstLogo({...saved,useBrandPalette:true},{...saved,useBrandPalette:true}),false);
 const patch=logoPalettePatch(id,['#0061ad','#0061AD','#FFFFFF','#0061AD']);assert.equal(patch.primaryColorHex,'#0061AD');assert.equal(patch.accentColorHex,'#FFFFFF');assert.equal(patch.paletteMode,'logo');assert.deepEqual(patch.additionalColorHexes,[]);
 assert.equal(logoPalettePatch(id,['#FFFFFF']).accentColorHex,'#171717');assert.throws(()=>logoPalettePatch(id,['bad']));assert.equal(paletteFingerprint(saved),paletteFingerprint({...saved,businessName:'Unrelated text edit'}));
});
