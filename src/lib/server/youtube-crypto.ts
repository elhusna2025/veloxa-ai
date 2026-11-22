import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './http';

export const youtubeToken = z.string().min(1).max(8192).regex(/^[A-Za-z0-9._~+/-]+=*$/);
const tokens = z.object({ accessToken: youtubeToken, refreshToken: youtubeToken });
type TokenPair = z.infer<typeof tokens>;
type GrantIdentity = { workspaceId: string; businessId: string; authorizationId: string };
const grantAAD = ({ workspaceId, businessId, authorizationId }: GrantIdentity) =>
  Buffer.from(JSON.stringify(['youtube', workspaceId, businessId, authorizationId]));

export function encryptYouTubeTokens(pair: TokenPair, identity: GrantIdentity, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(grantAAD(identity));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens.parse(pair)), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

export function decryptYouTubeTokens(value: string, identity: GrantIdentity, key: Buffer) {
  try {
    if (value.length > 24_000) throw new Error();
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error();
    const [iv, tag, ciphertext] = parts.map(part => {
      const bytes = Buffer.from(part, 'base64url');
      if (!bytes.length || bytes.toString('base64url') !== part) throw new Error();
      return bytes;
    });
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(grantAAD(identity));
    decipher.setAuthTag(tag);
    return tokens.parse(JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')));
  } catch {
    throw new ApiError(409, 'Koneksi YouTube perlu dihubungkan ulang.', 'reconnect_required');
  }
}
