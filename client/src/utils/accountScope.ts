import { getStoredJson, setStoredJson } from './storageUtils';

/**
 * Local map lists, labels, and IndexedDB documents are kept after sign-out,
 * but only the account that saved them may see them.
 * `open` is the pre-login and test mode: legacy unscoped keys stay readable.
 */
export type AccountScope =
  | { mode: 'open' }
  | { mode: 'hidden' }
  | { mode: 'account'; userId: string };

const ACCOUNT_ID_KEY = 'ourmaps_account_id';
const SIGNED_OUT_KEY = 'ourmaps_signed_out';

const ACCOUNT_CACHE_BASES = [
  'cached_maps',
  'cached_download_statuses',
  'cached_user_labels',
  'cached_map_label_assignments',
  'cached_system_label_settings',
  'cached_system_label_map_order',
  'cached_selected_label',
] as const;

let scope: AccountScope = { mode: 'open' };
const listeners = new Set<() => void>();

export function getAccountScope(): AccountScope {
  return scope;
}

export function subscribeAccountScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function scopesMatch(current: AccountScope, next: AccountScope): boolean {
  if (current.mode !== next.mode) return false;
  if (current.mode === 'account' && next.mode === 'account') return current.userId === next.userId;
  return true;
}

function setScope(next: AccountScope) {
  if (scopesMatch(scope, next)) return;
  scope = next;
  for (const listener of listeners) listener();
}

export function accountStorageKey(base: string, userId: string): string {
  return `${base}::${userId}`;
}

export function isAccountScopedStorageKey(key: string): boolean {
  return ACCOUNT_CACHE_BASES.some((base) => key.startsWith(`${base}::`));
}

function readAccountId(): string | null {
  try {
    return localStorage.getItem(ACCOUNT_ID_KEY);
  } catch {
    return null;
  }
}

function isSignedOutFlag(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function migrateLegacyCaches(userId: string, previousId: string | null) {
  const legacyOwner = !previousId || previousId === userId ? userId : previousId;
  for (const base of ACCOUNT_CACHE_BASES) {
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(base);
    } catch {
      legacy = null;
    }
    if (legacy === null) continue;
    const dest = accountStorageKey(base, legacyOwner);
    try {
      if (localStorage.getItem(dest) === null) localStorage.setItem(dest, legacy);
      localStorage.removeItem(base);
    } catch {
      // Leave the legacy key if storage is unavailable.
    }
  }
}

/** Remember this account and move any pre-scope cache onto that account. Returns the previous account id. */
export function noteSignedInAccount(userId: string): string | null {
  const previous = readAccountId();
  migrateLegacyCaches(userId, previous);
  try {
    localStorage.setItem(ACCOUNT_ID_KEY, userId);
    localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // The in-memory scope still limits this session.
  }
  setScope({ mode: 'account', userId });
  return previous;
}

export function noteSignedOut(): void {
  try {
    localStorage.setItem(SIGNED_OUT_KEY, '1');
  } catch {
    // Still hide for this page session.
  }
  setScope({ mode: 'hidden' });
}

/** `/api/auth/me` could not be reached. Keep the last account's copies only if they did not sign out. */
export function noteSessionUnreachable(): void {
  if (isSignedOutFlag()) {
    setScope({ mode: 'hidden' });
    return;
  }
  const id = readAccountId();
  if (id) setScope({ mode: 'account', userId: id });
  else setScope({ mode: 'open' });
}

/**
 * Call before the first child reads caches.
 * Online loads stay hidden until the session is confirmed, so a signed-out
 * browser does not paint the previous account's maps.
 */
export function installAccountScopeFromStorage(): void {
  if (isSignedOutFlag()) {
    setScope({ mode: 'hidden' });
    return;
  }
  const id = readAccountId();
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline && id) {
    setScope({ mode: 'account', userId: id });
    return;
  }
  if (offline && !id) {
    setScope({ mode: 'open' });
    return;
  }
  setScope({ mode: 'hidden' });
}

export function resetAccountScopeForTests(): void {
  const changed = scope.mode !== 'open';
  scope = { mode: 'open' };
  try {
    localStorage.removeItem(ACCOUNT_ID_KEY);
    localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // ignore
  }
  if (changed) {
    for (const listener of listeners) listener();
  }
}

function activeStorageKey(base: string): string | null {
  if (scope.mode === 'hidden') return null;
  if (scope.mode === 'open') return base;
  return accountStorageKey(base, scope.userId);
}

export function readAccountJson<T>(base: string, fallback: T): T {
  const key = activeStorageKey(base);
  if (!key) return fallback;
  return getStoredJson(key, fallback);
}

export function writeAccountJson<T>(base: string, value: T): boolean {
  const key = activeStorageKey(base);
  if (!key) return false;
  return setStoredJson(key, value);
}

export function removeAccountJson(base: string): void {
  const key = activeStorageKey(base);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
