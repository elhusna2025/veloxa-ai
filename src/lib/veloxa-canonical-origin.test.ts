import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAppDestination, LEGACY_VELOXA_ORIGIN } from './veloxa-canonical-origin';
const official = 'https://veloxa.dafinicode.com';

test('legacy page navigation moves to the official domain with its path and harmless page state', () => {
  assert.equal(canonicalAppDestination(LEGACY_VELOXA_ORIGIN + '/onboarding/?edit=1#brand', official), official + '/onboarding/?edit=1#brand');
  assert.equal(canonicalAppDestination(LEGACY_VELOXA_ORIGIN + '/?instagram=authorized#_=_', official), official + '/?instagram=authorized#_=_');
});
test('sensitive credentials are removed from query strings and fragments while safe page state remains', () => {
  assert.equal(
    canonicalAppDestination(LEGACY_VELOXA_ORIGIN + '/login?access_token=secret&campaign=spring&clientSecret=private#id_token=hidden&tab=profile', official),
    official + '/login?campaign=spring#tab=profile',
  );
  assert.equal(
    canonicalAppDestination(LEGACY_VELOXA_ORIGIN + '/?code=oauth-code&view=grid#access_token=hidden&section=home', official),
    official + '/?view=grid#section=home',
  );
});
test('official, development, unknown origins and server-owned authentication callbacks never get relayed', () => {
  for (const href of [official + '/login/', 'http://localhost:3000/', 'https://unrelated.example.test/', LEGACY_VELOXA_ORIGIN + '/api', LEGACY_VELOXA_ORIGIN + '/api/veloxa/instagram/callback/?code=example', LEGACY_VELOXA_ORIGIN + '/api/veloxa/meta/callback?code=example', LEGACY_VELOXA_ORIGIN + '/__/auth', LEGACY_VELOXA_ORIGIN + '/__/auth/handler']) assert.equal(canonicalAppDestination(href, official), null);
  assert.equal(canonicalAppDestination(LEGACY_VELOXA_ORIGIN), null);
});
test('misconfigured origins cannot create insecure or external redirects through path interpretation', () => {
  const credentialOrigin = new URL(official); credentialOrigin.username = 'untrusted';
  for (const origin of ['http://veloxa.dafinicode.com', official + '/other-path', official + '?next=x', official + '#x', '//evil.example.test', credentialOrigin.toString()]) assert.equal(canonicalAppDestination(LEGACY_VELOXA_ORIGIN, origin), null);
  const current = new URL(LEGACY_VELOXA_ORIGIN); current.pathname = '//evil.example.test/landing';
  const destination = new URL(canonicalAppDestination(current.toString(), official)!);
  assert.equal(destination.origin, official);
  assert.equal(destination.pathname, '//evil.example.test/landing');
});
