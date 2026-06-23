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
 * Requests persistent storage from the browser to prevent eviction.
 */
export async function requestPersistentStorage(): Promise<boolean> {
    if (navigator.storage && navigator.storage.persist) {
        return await navigator.storage.persist();
    }
    return false;
}
