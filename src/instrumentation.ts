export async function register() {
  if (typeof globalThis.localStorage !== 'undefined' && typeof globalThis.localStorage.getItem !== 'function') {
    try {
      delete (globalThis as Record<string, unknown>).localStorage;
    } catch {
      // ignore
    }
  }
}
