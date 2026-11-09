import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VeloxaWorkspaceOverview } from '../components/VeloxaWorkspaceOverview';
import { BRAND_PRESETS, SUBSCRIPTION_PLANS } from './veloxa-engine';
test('an unverified connection check is distinct from a verified empty or connected account list',()=>{
 const known={channel:'instagram',connected:true,handle:'@lastknown',accountName:'Brand',followerCount:0,oauthMode:'direct_publish',tokenExpiresAt:null,lastPublishedAt:null};
 const render=(verified:boolean,connections:unknown[])=>renderToStaticMarkup(createElement(VeloxaWorkspaceOverview,{brand:BRAND_PRESETS.cafe_fnb,currentPlan:SUBSCRIPTION_PLANS.free_trial,postsUsedThisMonth:0,drafts:[],connections,connectionsVerified:verified,onCreateContent:()=>{},onEditProfile:()=>{},onOpenOAuthConfigModal:()=>{}} as unknown as Parameters<typeof VeloxaWorkspaceOverview>[0]));
 const unknownEmpty=render(false,[]);assert.match(unknownEmpty,/Status akun sosial belum dapat diperiksa/);assert.doesNotMatch(unknownEmpty,/Belum ada akun terhubung/);
 assert.match(render(true,[]),/Belum ada akun terhubung/);
 const stale=render(false,[known]);assert.match(stale,/@lastknown/);assert.match(stale,/Status tersimpan, belum diperbarui/);assert.doesNotMatch(stale,/aria-label="Terhubung"/);
 assert.match(render(true,[known]),/aria-label="Terhubung"/);
});
