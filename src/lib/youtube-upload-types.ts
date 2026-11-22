// FROZEN integration contract for the YouTube file upload Studio.
// API replies are authenticated owner-only, scoped to workspace+business.
export const YOUTUBE_CHUNK_BYTES = 4 * 1024 * 1024;
export const YOUTUBE_MAX_BYTES = 128 * 1024 * 1024;
export type YouTubeUploadKind = 'video' | 'short';
export type YouTubePrivacy = 'private' | 'unlisted' | 'public';
export type YouTubeUploadMetadata = { title:string; description:string; privacy:YouTubePrivacy; madeForKids:boolean; containsSyntheticMedia:boolean };
export type YouTubeUploadFile = { name:string; size:number; mimeType:'video/mp4'|'video/quicktime'|'video/webm'; chunkHashes:string[] };
export type YouTubeUploadConnection = { channelId:string; title:string; handle:string; url:string; revision:string; status:'connected'|'reconnect_required' };
export type YouTubeUploadPermission = {
 ok:true; configured:boolean; connection:YouTubeUploadConnection|null; canUpload:boolean; uploadStorageReady?:boolean; startRevision:number;
 pending?:{ authorizationId:string; channelId:string; title:string; handle:string; url:string; connectionRevision:string };
};
export type YouTubeUploadState='receiving'|'validating'|'queued'|'uploading'|'processing'|'ready'|'retry_wait'|'needs_permission'|'needs_review'|'rejected'|'cancelled';
export type YouTubeUploadOperation = {
 id:string; revision:number; workspaceId:string; businessId:string; channelId:string; channelTitle:string; connectionRevision:string;
 kind:YouTubeUploadKind; file:{name:string;size:number;mimeType:string;chunkHashes:string[]}; metadata:YouTubeUploadMetadata;
 state:YouTubeUploadState; canCancel?:boolean; reconciliationOnly?:boolean; stagedBytes:number; youtubeBytes:number; totalBytes:number; missingChunks:number[];
 createdAt:number; updatedAt:number; retryAt?:number; message?:string;
 measured?:{durationSeconds:number;width:number;height:number;shortsEligible:boolean;durationIsLowerBound?:boolean};
 video?:{id:string;url:string;privacy:YouTubePrivacy;processingStatus:string};
};
export type YouTubeUploadList={ok:true;operations:YouTubeUploadOperation[];limits:{maxBytes:number;chunkBytes:number}};
// GET /api/veloxa/youtube/upload-permission?workspaceId&businessId -> YouTubeUploadPermission.
// POST .../upload-permission/start {workspaceId,businessId,channelId,connectionRevision,startRevision}->{ok:true,url}; exact scopes readonly+upload, existing registered callback.
// POST .../upload-permission {workspaceId,businessId,authorizationId,channelId,connectionRevision}->{ok:true}; explicit permission confirm, same exact existing channel.
// Callback redirects /?youtube_upload=authorized|failed; return intent key veloxa:youtube-upload:return:${workspaceId}, {workspaceId,businessId,createdAt}.
// GET /api/veloxa/youtube/uploads?workspaceId&businessId -> YouTubeUploadList.
// POST .../uploads {workspaceId,businessId,operationId(UUID),channelId,connectionRevision,kind,file,metadata,confirmed:true} -> {ok:true,operation}; immutable reviewed snapshot, same operationId reused on lost response.
// GET .../uploads/[id]?workspaceId&businessId -> {ok:true,operation}.
// PUT .../uploads/[id]/chunk?workspaceId&businessId&index=N raw application/octet-stream <=4MiB -> {ok:true,operation}; hashes validated server-side, each chunk immutable private GCS object, object generation stored.
// POST .../uploads/[id]/action {workspaceId,businessId,action:'process'|'check'|'cancel'} -> {ok:true,operation}; no replacement upload on unknown final result.
// Browser GET reads only; UI action process accelerates same durable operation, scheduler tick drives when tab closed.
// All provider/session URLs and tokens stay server-only. Private default always explicit. No thumbnails/scheduling/AI generation in this increment.
