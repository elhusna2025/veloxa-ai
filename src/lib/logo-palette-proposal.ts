import type {BrandProfile} from './veloxa-types';
import {normalizeBrandHex} from './brand-visual-dna';
export function paletteFingerprint(brand:BrandProfile):string{return JSON.stringify([brand.logoAssetId||'',brand.useBrandPalette===true,brand.paletteMode||'',brand.primaryColorHex,brand.accentColorHex,brand.additionalColorHexes||[]]);}
export function canAutoFillFirstLogo(saved:BrandProfile,form:BrandProfile):boolean{return!saved.logoAssetId&&saved.useBrandPalette!==true&&form.paletteMode!=='manual'&&paletteFingerprint(saved)===paletteFingerprint(form);}
export function logoPalettePatch(assetId:string,colors:string[]):Partial<BrandProfile>{
 if(!/^[a-f0-9-]{36}$/i.test(assetId)||!Array.isArray(colors)||!colors.length||colors.length>6)throw new Error('Saran palet tidak valid.');
 const unique=[...new Set(colors.map(normalizeBrandHex))];const primaryColorHex=unique[0];const rgb=primaryColorHex.slice(1).match(/../g)!.map(value=>parseInt(value,16));const accentColorHex=Math.min(...rgb)>220?'#171717':'#FFFFFF';
 return{logoAssetId:assetId,paletteMode:'logo',useBrandPalette:true,primaryColorHex,accentColorHex,additionalColorHexes:unique.filter(color=>color!==primaryColorHex&&color!==accentColorHex).slice(0,4)};
}
