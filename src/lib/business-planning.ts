import { buildMetaAdCampaignPlan } from './veloxa-engine';
import { assertBusinessTargets, draftBusiness, businessTargetId, type BusinessContext } from './business-context';
import type { ChannelConnectionState, ContentDraft, MetaAdObjective } from './veloxa-types';
export function businessDraftsForAccount(drafts:ContentDraft[],id:string,account='') {
 return drafts.filter(draft=>draftBusiness(draft)===id&&(!account||draft.publishTargets?.some(target=>businessTargetId(target)===account)));
}
export function makeBusinessAdPlan(context:BusinessContext,accounts:ChannelConnectionState[],input:{connectionIds:string[];title:string;daily:number;duration:number;dailyCap:number;monthlyCap:number;objective:MetaAdObjective;source?:ContentDraft;targetCity?:string;radiusKm?:number;ageMin?:number;ageMax?:number;customInterestKeyword?:string}) {
 if(!input.connectionIds.length||new Set(input.connectionIds).size!==input.connectionIds.length)throw new Error('Pilih setidaknya satu akun tujuan bisnis ini.');
 assertBusinessTargets([context],context.id,input.connectionIds);
 if(input.source&&draftBusiness(input.source)!==context.id)throw new Error('Konten sumber berasal dari bisnis lain.');
 const targets=input.connectionIds.map(id=>{const account=accounts.find(item=>item.connectionId===id&&item.connected);if(!account)throw new Error('Akun tujuan perlu dihubungkan ulang.');return{connectionId:id,channel:account.channel,handle:account.handle,accountName:account.accountName};});
 if(input.objective==='WEBSITE_CONVERSIONS'&&!context.brand.websiteUrl)throw new Error('Isi website pada profil bisnis sebelum merancang iklan kunjungan website.');
 if(input.objective==='WHATSAPP_MESSAGES'&&!/^\d{8,16}$/.test(context.brand.whatsappNumber))throw new Error('Isi nomor WhatsApp bisnis yang valid sebelum merancang iklan pesan.');
 if(input.objective==='INSTAGRAM_PROFILE_VISITS'&&targets.some(target=>target.channel!=='instagram'))throw new Error('Tujuan kunjungan profil Instagram hanya mendukung akun Instagram.');
 if((input.ageMin===undefined)!==(input.ageMax===undefined))throw new Error('Isi kedua batas rentang usia sebelum menyimpan.');
 if(input.ageMin!==undefined&&(!Number.isInteger(input.ageMin)||!Number.isInteger(input.ageMax)||input.ageMin<18||input.ageMax!>65||input.ageMin>=input.ageMax!))throw new Error('Rentang usia harus valid, antara 18 dan 65 tahun.');
 if(input.radiusKm!==undefined&&(!Number.isFinite(input.radiusKm)||input.radiusKm<3||input.radiusKm>80))throw new Error('Radius rencana harus antara 3 dan 80 km.');
 const plan=buildMetaAdCampaignPlan({brand:context.brand,metaAccount:{connected:false,adAccountId:'',adAccountName:'',businessPortfolioName:'',currency:'IDR',paymentMethodLabel:'',dailyHardCapIdr:input.dailyCap,monthlyHardCapIdr:input.monthlyCap,autoOptimizeEnabled:false,autoBoostOrganicWinners:false},objective:input.objective,promotedOfferingTitle:input.title,requestedDailyBudgetIdr:input.daily,durationDays:input.duration,targetCity:input.targetCity||context.brand.city,radiusKm:input.radiusKm,ageMin:input.ageMin,ageMax:input.ageMax,customInterestKeyword:input.customInterestKeyword,originatedFromOrganicDraft:input.source});
 return {...plan,demographics:{...plan.demographics,...(input.ageMin!==undefined?{ageMin:input.ageMin,ageMax:input.ageMax!}:{})},destinationUrlOrWa:input.objective==='INSTAGRAM_PROFILE_VISITS'&&targets.length===1?`https://www.instagram.com/${encodeURIComponent(targets[0].handle.replace(/^@/,''))}/`:plan.destinationUrlOrWa,businessId:context.id,status:'draft_paused' as const,destinationAccounts:targets};
}
