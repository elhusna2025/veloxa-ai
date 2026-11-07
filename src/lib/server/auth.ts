import { z } from 'zod';
import { adminAuth, adminDb } from './firebase';
import { ApiError } from './http';
import { isVerifiedAdmin } from '../veloxa-workspace-policy';
import { hasWorkspaceAccess } from '../veloxa-workspace-policy';
export { hasWorkspaceAccess } from '../veloxa-workspace-policy';

export const workspaceIdSchema = z.string().min(1).max(512).refine(value => !value.includes('/') && value !== '.' && value !== '..');

export async function requireUser(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i);
  if (!match) throw new ApiError(401, 'Silakan masuk ke akun Veloxa Anda.', 'unauthenticated');
  try {
    const user = await adminAuth().verifyIdToken(match[1], true);
    if (user.firebase?.sign_in_provider === 'anonymous') throw new ApiError(401, 'Silakan masuk dengan akun terdaftar.', 'unauthenticated');
    return user;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = (error as { code?: string })?.code || '';
    if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(code)) throw new ApiError(401, 'Sesi berakhir. Silakan masuk kembali.', 'unauthenticated');
    throw new ApiError(503, 'Verifikasi sesi belum tersedia. Konfigurasi Firebase server perlu diperiksa.', 'auth_service_unavailable');
  }
}

export async function requireWorkspace(request: Request, rawWorkspaceId: unknown, ownerOnly = false) {
  const workspaceId = workspaceIdSchema.parse(rawWorkspaceId);
  const user = await requireUser(request);
  const ref = adminDb().collection('workspaces').doc(workspaceId);
  const snap = await ref.get();
  const workspace = snap.data();
  const isAdmin = isVerifiedAdmin(user);
  if (!workspace || !hasWorkspaceAccess(user.uid, workspace, isAdmin) || (ownerOnly && !isAdmin && workspace.ownerUid !== user.uid)) {
    throw new ApiError(403, 'Anda tidak memiliki izin untuk workspace ini.', 'forbidden');
  }
  return { user, workspace, workspaceId, ref };
}
