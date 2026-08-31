/**
 * Storage Utilities for Web
 */

export interface StorageEstimate {
    quota: number;     // Total bytes available
    usage: number;     // Current usage in bytes
    remaining: number; // Bytes left
}

/**
 * Gets the current storage estimate from the browser.
 */
export async function getStorageEstimate(): Promise<StorageEstimate> {
    if (navigator.storage && navigator.storage.estimate) {
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

/**
 * Checks if a proposed download (in MB) will fit in the available storage.
 */
export async function canFit(mb: number): Promise<{ ok: boolean, message?: string }> {
    const bytesNeeded = mb * 1024 * 1024;
    const estimate = await getStorageEstimate();

    if (estimate.quota === 0) return { ok: true }; // No API support, proceed with caution

    if (bytesNeeded > estimate.remaining) {
        const remainingMB = (estimate.remaining / (1024 * 1024)).toFixed(1);
        return { 
            ok: false, 
            message: `Not enough storage. You need ${mb.toFixed(1)} MB but only ${remainingMB} MB is available.` 
        };
    }

    // Safety check: Don't use more than 90% of available quota
    if ((estimate.usage + bytesNeeded) > (estimate.quota * 0.9)) {
        return {
            ok: true,
            message: `Warning: This download will use over 90% of your available map storage.`
        };
    }

    return { ok: true };
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
