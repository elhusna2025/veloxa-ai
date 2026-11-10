import test from 'node:test';
import assert from 'node:assert/strict';
import { accountIdForChannel, socialAccountOptions, eligibleSocialChoices, parseReconnectIntent } from './social-account-options';
import type { ChannelConnectionState } from './veloxa-types';
const connection = (channel: 'instagram' | 'facebook', accountId: string, connected = true) => ({channel,accountId,connectionId:`${channel}_${accountId}`,connected,accountName:'Brand',handle:'@same-name',followerCount:0,tokenExpiresAt:null,lastPublishedAt:null,oauthMode:'direct_publish'}) as ChannelConnectionState;
const candidates = [{id:'123',label:'@old-name'},{id:'456',label:'@same-name'},{id:'789',label:'@new-account'}];
test('Add mode excludes existing active and expired identities, not matching usernames', () => {
  const options = socialAccountOptions('instagram',candidates,[connection('instagram','123'),connection('instagram','456',false)]);
  assert.deepEqual(options.map(item=>item.eligible),[false,false,true]);
  assert.deepEqual(eligibleSocialChoices(options,['123','456','789','789','999']),['789']);
  assert.equal(options[0].existing?.connected,true);
  assert.equal(options[1].existing?.connected,false);
  assert.equal(socialAccountOptions('instagram',[{id:'999',label:'@same-name'}],[connection('instagram','123')])[0].eligible,true);
});
test('Facebook and Instagram identical numeric IDs are separate; stable and legacy identities match', () => {
  assert.equal(socialAccountOptions('facebook',[candidates[0]],[connection('instagram','123')])[0].eligible,true);
  const stable={...connection('instagram','123'),accountId:undefined};
  assert.equal(accountIdForChannel(stable,'instagram'),'123');
  const legacy={...connection('instagram','123'),connectionId:'instagram'};
  assert.equal(socialAccountOptions('instagram',[candidates[0]],[legacy])[0].eligible,false);
  assert.equal(accountIdForChannel({...stable,connectionId:'facebook_123'},'instagram'),null);
});
test('Reconnect mode allows exactly the existing selected identity, never another account', () => {
  const connections=[connection('instagram','123'),connection('instagram','456')];
  const options=socialAccountOptions('instagram',candidates,connections,'123');
  assert.deepEqual(eligibleSocialChoices(options,['123','456','789']),['123']);
  assert.deepEqual(socialAccountOptions('facebook',candidates,connections,'123').map(item=>item.eligible),[false]);
  assert.deepEqual(socialAccountOptions('instagram',candidates,connections,'999'),[]);
});
test('Refreshed accounts prune successfully added choices after partial save', () => {
  const chosen=['123','456','789'];
  assert.deepEqual(eligibleSocialChoices(socialAccountOptions('instagram',candidates,[]),chosen),chosen);
  assert.deepEqual(eligibleSocialChoices(socialAccountOptions('instagram',candidates,[connection('instagram','123')]),chosen),['456','789']);
  assert.deepEqual(eligibleSocialChoices(socialAccountOptions('instagram',[],[]),chosen),[]);
});
test('Reconnect return intent is scoped, expiring, validated and never inferred from a grant', () => {
  const now=1_000_000;
  const value={version:1,workspaceId:'ws-A',provider:'instagram',accountId:'123',createdAt:now-1};
  const parse=(overrides:Record<string,unknown>={})=>parseReconnectIntent(JSON.stringify({...value,...overrides}),'ws-A','instagram',now);
  assert.deepEqual(parse(),{accountId:'123'});
  for(const overrides of [{workspaceId:'ws-B'},{provider:'facebook'},{accountId:'@brand'},{accountId:123},{version:2},{createdAt:now-900_001},{createdAt:now+1},{createdAt:'recent'}]) assert.equal(parse(overrides),null);
  for(const raw of [null,'{','[]','null']) assert.equal(parseReconnectIntent(raw,'ws-A','instagram',now),null);
});
