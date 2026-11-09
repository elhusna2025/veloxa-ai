export class SnapshotConflictError extends Error {
 constructor(){super('Data workspace telah berubah di tab atau perangkat lain. Isian Anda tetap ada. Muat ulang halaman sebelum menyimpan kembali.');}
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
