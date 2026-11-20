import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VeloxaWorkspaceOverview } from '../components/VeloxaWorkspaceOverview';
import { BRAND_PRESETS, SUBSCRIPTION_PLANS } from './veloxa-engine';
import type { ChannelConnectionState } from './veloxa-types';
test('an unverified connection check is distinct from a verified empty or connected account list',()=>{
 const known: ChannelConnectionState ={channel:'instagram',connected:true,handle:'@lastknown',accountName:'Brand',followerCount:0,oauthMode:'direct_publish',tokenExpiresAt:null,lastPublishedAt:null};
 const render=(verified:boolean,connections:ChannelConnectionState[])=>renderToStaticMarkup(createElement(VeloxaWorkspaceOverview,{brand:BRAND_PRESETS.cafe_fnb,quota:SUBSCRIPTION_PLANS.free_trial.monthlyPostQuota,postsUsed:0,drafts:[],connections,connectionsVerified:verified,onCreateContent:()=>{},onEditProfile:()=>{},onConnections:()=>{},onStudio:()=>{}}));
 const unknownEmpty=render(false,[]);assert.match(unknownEmpty,/Status akun sosial belum dapat diperiksa/);assert.doesNotMatch(unknownEmpty,/Belum ada akun terhubung/);
 assert.match(render(true,[]),/Belum ada akun terhubung/);
 const connectedLabel=/>Terhubung<\/span>/;
 const stale=render(false,[known]);assert.match(stale,/@lastknown/);assert.match(stale,/Status tersimpan, belum diperbarui/);assert.doesNotMatch(stale,connectedLabel);
 assert.match(render(true,[known]),connectedLabel);
});

test('workspace overview shows unlimited publishing without a fictitious remaining quota', () => {
 const render = (quota: number | null) => renderToStaticMarkup(createElement(VeloxaWorkspaceOverview, {
  brand: BRAND_PRESETS.cafe_fnb, quota, postsUsed: 25, drafts: [], connections: [], connectionsVerified: true,
  onCreateContent:()=>{}, onEditProfile:()=>{}, onConnections:()=>{}, onStudio:()=>{},
 }));
 const unlimited = render(null);
 assert.match(unlimited, /Tanpa batas/);
 assert.doesNotMatch(unlimited, /25 \/ 20|25 \/ 0|null|NaN/);
 assert.match(render(30), /25 \/ 30/);
});
