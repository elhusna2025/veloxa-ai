import type { BrandProfile } from './veloxa-types';
function canonical(value: unknown): unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
 return value;
}
/** Shared browser/server fingerprint of the complete saved profile, independent of key order. */
export async function profileFingerprint(brand: BrandProfile): Promise<string> {
 const bytes=new TextEncoder().encode(JSON.stringify(canonical(brand)));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
