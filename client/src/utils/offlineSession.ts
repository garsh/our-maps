export const OFFLINE_SESSION_KEY = 'ourmaps_offline';
export const AUTO_VIEW_SESSION_KEY = 'ourmaps_offline_auto_view';

export function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeSessionFlag(key: string, value: boolean): void {
  try {
    if (value) sessionStorage.setItem(key, '1');
    else sessionStorage.removeItem(key);
  } catch {
    // ignore quota / private-mode failures
  }
}

export function isForcedOffline(): boolean {
  return (typeof navigator !== 'undefined' && !navigator.onLine) || readSessionFlag(OFFLINE_SESSION_KEY);
}

export function setForcedOffline(offline: boolean): void {
  writeSessionFlag(OFFLINE_SESSION_KEY, offline);
}
