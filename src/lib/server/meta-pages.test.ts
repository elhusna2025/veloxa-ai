import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverMetaPages } from './meta-pages';

const page = (id: string) => ({ id, name: 'Customer Page ' + id, access_token: 'fixture-token', tasks: ['CREATE_CONTENT'], instagram_business_account: { id: '800', username: 'customer' } });

test('OAuth discovery follows safe cursors and retains every selectable Page', async () => {
  const values: Record<string, string>[] = [];
  const pages = await discoverMetaPages('fixture', [], async (path, query) => {
    assert.equal(path, 'me/accounts'); values.push(query);
    return query.after ? { data: [page('200')] } : { data: [page('100')], paging: { next: 'https://graph.facebook.com/unused?access_token=must-not-follow', cursors: { after: 'next-cursor' } } };
  });
  assert.deepEqual(pages.map(item => item.id), ['100', '200']); assert.equal(values[1].after, 'next-cursor');
});

test('the Cendekia Page-assignment edge case uses explicit Meta grant IDs, never a hard-coded customer Page', async () => {
  const paths: string[] = [];
  const pages = await discoverMetaPages('fixture', ['300', 'https://untrusted.example', '300'], async (path, query) => {
    paths.push(path);
    if (path === 'me/accounts') return { data: [] };
    assert.equal(query.fields.includes('tasks'), false);
    const { tasks: _edgeOnly, ...result } = page(path);
    return result;
  });
  assert.deepEqual(paths, ['me/accounts', '300']); assert.equal(pages[0].id, '300');
});

test('read-only Page access is not presented as publishing access', async () => {
  await assert.rejects(discoverMetaPages('fixture', [], async () => ({ data: [{ ...page('100'), tasks: ['ANALYZE'] }] })), /izin membuat konten/);
  await assert.rejects(discoverMetaPages('fixture', ['100'], async () => ({ data: [{ ...page('100'), tasks: ['ANALYZE'] }] })), /izin membuat konten/);
});
