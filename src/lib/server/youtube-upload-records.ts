import { ApiError } from './http';

export function youtubeUploadRefs(ref: FirebaseFirestore.DocumentReference, businessId: string) {
  return {
    grant: ref.collection('private_youtube_upload_grants').doc(businessId),
    pending: ref.collection('private_youtube_upload_authorizations').doc(businessId),
    guard: ref.collection('integration_guards').doc(`youtube_upload_${businessId}`),
  };
}

const needsPermissionMessage = 'Izin unggah YouTube tidak lagi berlaku. Periksa koneksi dan berikan izin kembali.';

export function youtubeUploadNeedsPermission() {
  return new ApiError(409, needsPermissionMessage, 'needs_permission');
}

export class YouTubeUploadTokenRejected extends ApiError {
  constructor() { super(409, needsPermissionMessage, 'needs_permission'); }
}
