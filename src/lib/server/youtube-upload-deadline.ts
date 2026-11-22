export type UploadWorkSignal = AbortSignal & { assertActive?: () => void };

export function assertWorkActive(signal?: UploadWorkSignal) {
  signal?.throwIfAborted();
  signal?.assertActive?.();
}
