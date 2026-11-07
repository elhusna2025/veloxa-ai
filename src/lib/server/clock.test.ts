import test from 'node:test';
import assert from 'node:assert/strict';
import { wibDay, wibMonth } from './clock';
test('daily and monthly quotas roll over in WIB instead of the server timezone', () => {
  assert.equal(wibDay(new Date('2026-11-06T18:00:00Z')), '2026-11-07');
  assert.equal(wibMonth(new Date('2026-12-31T17:00:00Z')), '2027-01');
  assert.equal(wibMonth(new Date('2026-12-31T16:59:59Z')), '2026-12');
});
