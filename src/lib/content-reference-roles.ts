import { MAX_CONTENT_REFERENCES } from './content-reference-options';
export const CONTENT_REFERENCE_ROLES = ['visual', 'logo', 'screenshot'] as const;
export type ContentReferenceRole = typeof CONTENT_REFERENCE_ROLES[number];
export type ContentReferenceRoles = Record<string, ContentReferenceRole>;
/** Roles are explicit choices, never inferred from filenames or client URLs. */
export function resolveReferenceRoles(ids: string[], roles: ContentReferenceRoles = {}): ContentReferenceRoles {
 if (ids.length > MAX_CONTENT_REFERENCES || new Set(ids).size !== ids.length) throw new Error('Pilih maksimal enam referensi yang berbeda.');
 if (!roles || typeof roles !== 'object' || Array.isArray(roles) || Object.keys(roles).some(id => !ids.includes(id))) throw new Error('Peran referensi harus berasal dari foto yang dipilih.');
 const resolved = Object.fromEntries(ids.map(id => [id, roles[id] ?? 'visual'])) as ContentReferenceRoles;
 if (Object.values(resolved).some(role => !(CONTENT_REFERENCE_ROLES as readonly string[]).includes(role))) throw new Error('Peran referensi tidak valid.');
 for (const role of ['logo', 'screenshot']) if (Object.values(resolved).filter(value => value === role).length > 1) throw new Error('Gunakan maksimal satu logo asli dan satu screenshot aplikasi dalam satu konten. Foto lainnya dapat menjadi acuan adegan.');
 return resolved;
}
