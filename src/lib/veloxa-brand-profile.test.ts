import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrandProfile } from './veloxa-brand-profile';
import { BRAND_PRESETS } from './veloxa-engine';
test('saving an edited profile preserves all existing products, colors and per-workspace identity', () => {
 const original=structuredClone(BRAND_PRESETS.cafe_fnb);original.workspaceId='my-workspace';
 const saved=normalizeBrandProfile({...original,businessName:' Berez ERP ',businessDescription:' Sistem pengelolaan usaha. ',brandTone:' Jelas dan profesional ',websiteUrl:'berez.example.test'});
 assert.equal(saved.workspaceId,original.workspaceId);assert.equal(saved.businessName,'Berez ERP');assert.equal(saved.businessDescription,'Sistem pengelolaan usaha.');assert.equal(saved.websiteUrl,'https://berez.example.test/');assert.deepEqual(saved.offerings,original.offerings);assert.equal(saved.primaryColorHex,original.primaryColorHex);assert.notEqual(original.businessName,saved.businessName);
});
test('blank names, invalid websites and overlong fields reject without mutating the form', () => {
 const original=structuredClone(BRAND_PRESETS.cafe_fnb);
 for(const change of [{businessName:' '},{websiteUrl:'javascript:alert(1)'},{websiteUrl:'https://user:credential@example.test'},{businessDescription:'x'.repeat(2001)},{city:'x'.repeat(81)}]){const form={...original,...change};const before=structuredClone(form);assert.throws(()=>normalizeBrandProfile(form));assert.deepEqual(form,before);}
});
