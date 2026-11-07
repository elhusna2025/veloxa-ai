/** Shared policy used by Next routes and callable Functions. No database or client state is trusted as an actor. */
export function hasWorkspaceAccess(uid: string, workspace: Record<string, unknown>, isAdmin = false) {
  return isAdmin || workspace.ownerUid === uid || (Array.isArray(workspace.memberUids) && workspace.memberUids.includes(uid));
}

export function isVerifiedAdmin(actor: { role?: unknown; email?: unknown; email_verified?: unknown }) {
  return actor.role === 'admin' || (actor.email_verified === true && actor.email === 'sosrospg@gmail.com');
}
