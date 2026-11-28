import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { youtubeNarratorDelivery } from '../youtube-production';

test('narrator direction includes the voiceover brief but excludes other sections', () => {
  assert.equal(youtubeNarratorDelivery({ delivery: 'Jeda alami.', topic: 'Cerita kota\n- Voice-over: Suara pria dalam dan tegas.\n- Musik: instrumental.' }), 'Jeda alami. Suara pria dalam dan tegas.');
  assert.equal(youtubeNarratorDelivery({ delivery: 'Santai.', topic: 'Cerita kota' }), 'Santai.');
});
