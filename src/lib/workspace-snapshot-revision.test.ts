import assert from 'node:assert/strict';
import test from 'node:test';
import {SnapshotWriteQueue,SnapshotConflictError,nextSnapshotRevision} from './workspace-snapshot-revision';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};

test('overlapping local saves commit in order using their own confirmed revisions',async()=>{
 const queue=new SnapshotWriteQueue();const gate=deferred();let stored=0;let baseline=0;const saved:string[]=[];
 const save=(name:string)=>queue.run('ws',async current=>{const expected=baseline;await gate.promise;const revision=nextSnapshotRevision({snapshotRevision:stored},expected);stored=revision;if(current())baseline=revision;saved.push(name);return revision;});
 const first=save('first');const second=save('second');gate.resolve();
 assert.deepEqual(await Promise.all([first,second]),[1,2]);assert.deepEqual(saved,['first','second']);assert.equal(baseline,2);
});

test('server profile refresh discards stale queued snapshots and protects its revision from an older in-flight result',async()=>{
 const queue=new SnapshotWriteQueue();const started=deferred();const gate=deferred();let baseline=0;let staleWrites=0;
 const first=queue.run('ws',async current=>{started.resolve();await gate.promise;if(current())baseline=1;return 1;});
 const stale=queue.run('ws',async()=>{staleWrites++;return 2;});
 const rejected=assert.rejects(stale,SnapshotConflictError);
 await started.promise;queue.invalidate('ws');baseline=10;
 const fresh=queue.run('ws',async current=>{assert.equal(baseline,10);if(current())baseline=11;return 11;});
 gate.resolve();await first;await rejected;assert.equal(await fresh,11);assert.equal(staleWrites,0);assert.equal(baseline,11);
});

test('another tab revision conflict is never silently rebased; later queued writes can proceed after an explicit reload',async()=>{
 const queue=new SnapshotWriteQueue();let baseline=0;let stored=4;
 await assert.rejects(queue.run('ws',async()=>nextSnapshotRevision({snapshotRevision:stored},baseline)),SnapshotConflictError);
 assert.equal(baseline,0);queue.invalidate('ws');baseline=stored;
 assert.equal(await queue.run('ws',async()=>{stored=nextSnapshotRevision({snapshotRevision:stored},baseline);return stored;}),5);
});

test('queue does not block a different workspace or remain blocked by failures',async()=>{
 const queue=new SnapshotWriteQueue();const gate=deferred();const first=queue.run('one',async()=>{await gate.promise;throw new Error('offline');});
 const rejected=assert.rejects(first,/offline/);assert.equal(await queue.run('two',async()=>2),2);
 const next=queue.run('one',async()=>3);gate.resolve();await rejected;assert.equal(await next,3);
});
