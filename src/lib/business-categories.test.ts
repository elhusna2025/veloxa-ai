import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_CATEGORIES, businessCategoryLabel } from './business-categories';
import { searchValidatedMetaInterests } from './veloxa-engine';
test('software and other new sectors retain the existing general Meta interest fallback', () => {
 assert.ok(BUSINESS_CATEGORIES.length >= 20);
 assert.equal(new Set(BUSINESS_CATEGORIES.map(item => item.value)).size, BUSINESS_CATEGORIES.length);
 for(const legacy of ['cafe_fnb','running_event','clinic_beauty','fashion_retail','education','custom']) assert.ok(BUSINESS_CATEGORIES.some(item => item.value===legacy));
 assert.equal(businessCategoryLabel('software_saas'),'Software & SaaS');
 assert.equal(businessCategoryLabel('unknown-legacy'),'Lainnya / umum');
 assert.deepEqual(searchValidatedMetaInterests('software_saas'),searchValidatedMetaInterests('custom'));
});
