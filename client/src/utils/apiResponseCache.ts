/** Workbox runtime cache name. Imported by vite.config.ts, which is typechecked without DOM libs. */
export const API_RESPONSE_CACHE = 'api-cache';

type CacheDeleter = { delete: (name: string) => Promise<boolean> };

/** Drop shared API responses so the next account cannot be served the previous one. */
export function deleteApiResponseCache(): void {
  const storage = (globalThis as { caches?: CacheDeleter }).caches;
  if (!storage || typeof storage.delete !== 'function') return;
  void storage.delete(API_RESPONSE_CACHE).catch(() => {});
}
