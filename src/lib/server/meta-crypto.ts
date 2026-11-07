import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ApiError } from './http';

function keyBytes() {
  const key = Buffer.from(process.env.META_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new ApiError(503, 'Penyimpanan aman koneksi Meta belum dikonfigurasi.', 'meta_not_configured');
  return key;
}

export function encryptMetaToken(token: string, workspaceId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  cipher.setAAD(Buffer.from(workspaceId));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

export function decryptMetaToken(value: string, workspaceId: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new ApiError(409, 'Koneksi Meta perlu dihubungkan ulang.', 'reconnect_required');
  const [iv, tag, data] = parts.map(part => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv);
  decipher.setAAD(Buffer.from(workspaceId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
