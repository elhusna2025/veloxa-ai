import { ApiError } from './http';

export async function assertNoYouTubeUploadDispatch(
  tx: FirebaseFirestore.Transaction, workspaceRef: FirebaseFirestore.DocumentReference, businessId: string,
): Promise<void> {
  const dispatch = (await tx.get(workspaceRef.collection('youtube_upload_dispatch').doc(businessId))).data();
  if (dispatch?.state === 'active' || dispatch?.state === 'unknown') {
    throw new ApiError(409, 'Koneksi YouTube tidak dapat diubah sampai hasil unggahan dipastikan.', 'youtube_upload_dispatch_conflict');
  }
}
