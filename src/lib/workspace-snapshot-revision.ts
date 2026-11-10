export class SnapshotConflictError extends Error {
 constructor(){super('Data workspace telah berubah di tab atau perangkat lain. Isian Anda tetap ada. Muat ulang halaman sebelum menyimpan kembali.');}
}
/** Serialize this client's writes; a server refresh invalidates all older queued work. */
export class SnapshotWriteQueue {
 private readonly epochs = new Map<string, number>();
 private readonly tails = new Map<string, Promise<void>>();
 invalidate(workspaceId: string) { this.epochs.set(workspaceId, (this.epochs.get(workspaceId) || 0) + 1); }
 run<T>(workspaceId: string, action: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
  const epoch = this.epochs.get(workspaceId) || 0;
  const isCurrent = () => epoch === (this.epochs.get(workspaceId) || 0);
  const previous = this.tails.get(workspaceId) || Promise.resolve();
  const result = previous.then(() => {
   if (!isCurrent()) throw new SnapshotConflictError();
   return action(isCurrent);
  });
  const tail = result.then(() => undefined, () => undefined);
  this.tails.set(workspaceId, tail);
  void tail.then(() => { if (this.tails.get(workspaceId) === tail) this.tails.delete(workspaceId); });
  return result;
 }
}
export function snapshotRevision(data: Record<string, unknown> | null): number {
 const value=data?.snapshotRevision ?? 0;
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)throw new SnapshotConflictError();
 return value;
}
export function nextSnapshotRevision(existing: Record<string, unknown> | null, expected: number | undefined): number {
 const current=snapshotRevision(existing);
 if(existing?(expected===undefined||expected!==current):expected!==undefined)throw new SnapshotConflictError();
 return current+1;
}
