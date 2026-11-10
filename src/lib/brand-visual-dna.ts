import type { BrandProfile } from './veloxa-types';
const hex = /^#[0-9a-f]{6}$/i;
export function normalizeBrandHex(value: unknown): string {
  if (typeof value !== 'string' || !hex.test(value.trim())) throw new Error('Gunakan kode warna HEX enam digit, misalnya #167D8D.');
  return value.trim().toUpperCase();
}
/** An explicit opt-in keeps legacy default colors from overriding existing references. */
export function savedBrandPalette(brand: BrandProfile): string[] {
  if (brand.useBrandPalette !== true) return [];
  const extras = brand.additionalColorHexes ?? [];
  if (!Array.isArray(extras) || extras.length > 4) throw new Error('Pilih maksimal empat warna tambahan.');
  return [...new Set([brand.primaryColorHex, brand.accentColorHex, ...extras].map(normalizeBrandHex))];
}
export function normalizeBrandVisualDna(brand: BrandProfile): BrandProfile {
  if(brand.paletteMode!==undefined&&!['logo','manual'].includes(brand.paletteMode))throw new Error('Mode palet tidak valid.');
  if (brand.logoAssetId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brand.logoAssetId)) throw new Error('Pilih logo dari Foto brand.');
  if (brand.useBrandPalette !== undefined && typeof brand.useBrandPalette !== 'boolean') throw new Error('Pengaturan palet tidak valid.');
  if (!brand.useBrandPalette) return { ...brand };
  savedBrandPalette(brand);
  const primaryColorHex = normalizeBrandHex(brand.primaryColorHex);
  const accentColorHex = normalizeBrandHex(brand.accentColorHex);
  return { ...brand, primaryColorHex, accentColorHex, additionalColorHexes: [...new Set((brand.additionalColorHexes || []).map(normalizeBrandHex))].filter(color => color !== primaryColorHex && color !== accentColorHex) };
}
