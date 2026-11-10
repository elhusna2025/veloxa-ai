import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SocialAccountPicker } from '../components/SocialAccountPicker';
import { connectionKey, withConnectionPlaceholders } from './social-account-identity';
import type { ChannelConnectionState } from './veloxa-types';
test('ten account picker choices retain distinct labels, selections and expired state',()=>{
 const accounts=Array.from({length:10},(_,i)=>({connectionId:`instagram_${100+i}`,accountId:String(100+i),channel:'instagram',connected:i!==9,accountName:`Brand ${i}`,handle:`@brand${i}`,followerCount:0,oauthMode:'direct_publish',tokenExpiresAt:null,lastPublishedAt:null})) as ChannelConnectionState[];
 const html=renderToStaticMarkup(createElement(SocialAccountPicker,{accounts,selected:['instagram_100','instagram_101'],onChange:()=>{}}));assert.equal((html.match(/type="checkbox"/g)||[]).length,10);assert.equal((html.match(/checked=""/g)||[]).length,2);assert.match(html,/Tujuan instagram @brand9/);assert.match(html,/disabled=""/);assert.match(html,/2 dipilih/);assert.equal(new Set(accounts.map(connectionKey)).size,10);assert.equal(withConnectionPlaceholders(accounts,accounts.slice(0,1)).length,10);
});
