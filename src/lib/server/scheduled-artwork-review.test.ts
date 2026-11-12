import assert from 'node:assert/strict';
import test from 'node:test';
import { passesScheduledArtworkReview } from './scheduled-artwork-review';

const params = {
  businessName: 'Berez ERP',
  title: 'Catat Transaksi',
  hook: 'Satukan penjualan dan pembelian.',
  cta: 'Pelajari selengkapnya',
  website: 'berez.dafinicode.com',
};
const copy = 'Berez ERP\nCatat Transaksi\nSatukan penjualan dan pembelian.\nPelajari selengkapnya\nberez.dafinicode.com';

test('scheduled artwork requires an acceptable layout and exactly the intended visible copy', () => {
  const check = (visibleCopy: string, layoutPasses = true) => passesScheduledArtworkReview(params, { visibleCopy, layoutPasses });
  assert.equal(check(copy), true);
  assert.equal(check(copy.replace('Catat Transaksi', 'Catat Transkasi')), false);
  assert.equal(check(copy + '\n1/5 Geser untuk lanjut'), false);
  assert.equal(check(copy.replace('Satukan penjualan dan pembelian.', '')), false);
  assert.equal(check(copy, false), false);
  assert.equal(passesScheduledArtworkReview(params, { visibleCopy: copy }), false);
});

test('Reels artwork checks the short overlay and omits the narration', () => {
  const reels = { ...params, aspectRatio: '9:16' as const, cta: '', website: '' };
  assert.equal(passesScheduledArtworkReview(reels, {visibleCopy:'Berez ERP\nCatat Transaksi',layoutPasses:true}), true);
  assert.equal(passesScheduledArtworkReview(reels, {visibleCopy:'berez erp\nCatat Transaksi',layoutPasses:true}), false);
  assert.equal(passesScheduledArtworkReview(reels, {visibleCopy:'Berez ERP\nCatat Transaksi\n'+params.hook,layoutPasses:true}), false);
});
