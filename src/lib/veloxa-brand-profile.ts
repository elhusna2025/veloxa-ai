import type { BrandProfile } from './veloxa-types';
/** Normalize only an explicitly saved form; keep legacy offerings and brand settings. */
export function normalizeBrandProfile(value: BrandProfile): BrandProfile {
  const businessName = value.businessName.trim();
  if (!businessName || businessName.length > 110) throw new Error('Isi nama bisnis, maksimal 110 karakter.');
  const fields = { businessDescription: value.businessDescription || '', city: value.city, targetAudience: value.targetAudience, brandTone: value.brandTone, defaultCta: value.defaultCta };
  const limits = { businessDescription: 2000, city: 80, targetAudience: 500, brandTone: 250, defaultCta: 300 };
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) if (fields[key].trim().length > limits[key]) throw new Error('Ada isian terlalu panjang. Ringkas teks sesuai batas karakter pada formulir.');
  let websiteUrl = value.websiteUrl.trim();
  if (websiteUrl) { try { const url = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(); websiteUrl = url.href; } catch { throw new Error('Isi alamat website yang valid, misalnya https://bisnisanda.com.'); } }
  return { ...value, businessName, ...Object.fromEntries(Object.entries(fields).map(([key, text]) => [key, text.trim()])), websiteUrl, forbiddenWords: value.forbiddenWords.map(word => word.trim()).filter(Boolean) };
}
