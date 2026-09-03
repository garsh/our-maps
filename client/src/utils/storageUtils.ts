/**
 * Storage Utilities for Web
 */

export interface StorageEstimate {
    quota: number;     // Total bytes available
    usage: number;     // Current usage in bytes
    remaining: number; // Bytes left
}

/** Chrome reports usage+10GiB from estimate() unless the origin has unlimited storage. */
export const CHROME_PRIVACY_QUOTA_HEADROOM = 10 * 1024 * 1024 * 1024;

export function isPrivacyCappedRemaining(remaining: number): boolean {
    if (remaining <= 0) return false;
    return Math.abs(remaining - CHROME_PRIVACY_QUOTA_HEADROOM) / CHROME_PRIVACY_QUOTA_HEADROOM < 0.02;
}

/**
 * Gets the current storage estimate from the browser.
 * Requests persistent storage first so Chrome may report the real origin quota
 * (~60% of disk) instead of the 10 GiB privacy cap.
 */
export async function getStorageEstimate(): Promise<StorageEstimate> {
    if (navigator.storage && navigator.storage.estimate) {
        try {
            await navigator.storage.persist?.();
        } catch {
            // persist() is best-effort; estimate() still works without it
        }
        const estimate = await navigator.storage.estimate();
        const quota = estimate.quota || 0;
        const usage = estimate.usage || 0;
        return {
            quota,
            usage,
            remaining: Math.max(0, quota - usage)
        };
    }
    
    // Fallback for browsers that don't support the API (very rare in 2026)
    return {
        quota: 0,
        usage: 0,
        remaining: 0
    };
}

const WARN_FRACTION_OF_AVAILABLE = 0.3;

export function formatStorageMB(mb: number): string {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    if (mb >= 10) return `${Math.round(mb)} MB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${Math.max(0.1, mb).toFixed(1)} MB`;
}

export interface DownloadFit {
    ok: boolean;
    warn: boolean;
    message?: string;
}

/**
 * Checks whether a proposed download (in MB) fits in remaining origin storage.
 * Warns when it would use more than 30% of remaining space. Blocks only when
 * it will not fit.
 */
export async function canFit(mb: number): Promise<DownloadFit> {
    const bytesNeeded = mb * 1024 * 1024;
    const estimate = await getStorageEstimate();

    if (estimate.quota === 0) return { ok: true, warn: false };

    const remainingMB = estimate.remaining / (1024 * 1024);
    if (bytesNeeded > estimate.remaining) {
        if (isPrivacyCappedRemaining(estimate.remaining)) {
            return {
                ok: true,
                warn: true,
                message: `This download is about ${formatStorageMB(mb)}. Chrome only reports about 10 GB of site storage (a privacy limit, not your disk space). Continue? The download may fail if the browser runs out of space.`,
            };
        }
        return {
            ok: false,
            warn: false,
            message: `Not enough storage. This download needs ${formatStorageMB(mb)} but only ${formatStorageMB(remainingMB)} is available.`,
        };
    }

    const fraction = estimate.remaining > 0 ? bytesNeeded / estimate.remaining : 1;
    if (fraction > WARN_FRACTION_OF_AVAILABLE) {
        return {
            ok: true,
            warn: true,
            message: `This download is about ${formatStorageMB(mb)} and will use ${Math.round(fraction * 100)}% of the ${formatStorageMB(remainingMB)} available. Continue?`,
        };
    }

    return { ok: true, warn: false };
}

/**
 * Safely reads and parses a JSON item from localStorage with error handling.
 */
export function getStoredJson<T>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined' || !window.localStorage) return defaultValue;
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) return defaultValue;
        return JSON.parse(raw) as T;
    } catch (err) {
        console.warn(`[storageUtils] Failed to parse localStorage key "${key}":`, err);
        return defaultValue;
    }
}

/**
 * Safely writes a JSON serializable value to localStorage with error handling.
 */
export function setStoredJson<T>(key: string, value: T): boolean {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (err) {
        console.warn(`[storageUtils] Failed to write to localStorage key "${key}":`, err);
        return false;
    }
}

/**
 * Safely reads a boolean value from localStorage with a default fallback.
 */
export function getStoredBoolean(key: string, defaultValue: boolean): boolean {
    if (typeof window === 'undefined' || !window.localStorage) return defaultValue;
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaultValue;
        return raw === 'true';
    } catch {
        return defaultValue;
    }
}

/**
 * Safely writes a boolean value to localStorage.
 */
export function setStoredBoolean(key: string, value: boolean): boolean {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    try {
        localStorage.setItem(key, String(value));
        return true;
    } catch {
        return false;
    }
}
