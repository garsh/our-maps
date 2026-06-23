package com.google.ourmaps.utils

import android.os.Environment
import android.os.StatFs
import java.io.File

object StorageUtils {
    /**
     * Gets the total available internal storage in bytes.
     */
    fun getAvailableInternalMemorySize(): Long {
        val path: File = Environment.getDataDirectory()
        val stat = StatFs(path.path)
        val blockSize = stat.blockSizeLong
        val availableBlocks = stat.availableBlocksLong
        return availableBlocks * blockSize
    }

    /**
     * Checks if a proposed download (in MB) will fit in available storage.
     */
    fun canFit(mb: Long): Pair<Boolean, String?> {
        val bytesNeeded = mb * 1024 * 1024
        val availableBytes = getAvailableInternalMemorySize()

        if (bytesNeeded > availableBytes) {
            val availableMB = availableBytes / (1024 * 1024)
            return Pair(false, "Not enough storage. You need ${mb} MB but only ${availableMB} MB is available.")
        }

        // Warning if using more than 80% of current available space
        if (bytesNeeded > (availableBytes * 0.8)) {
            return Pair(true, "Warning: This download will use most of your remaining storage space.")
        }

        return Pair(true, null)
    }

    /**
     * Formats bytes to human-readable string (MB or GB).
     */
    fun formatSize(bytes: Long): String {
        val mb = bytes / (1024.0 * 1024.0)
        return if (mb >= 1024) {
            String.format("%.2f GB", mb / 1024.0)
        } else {
            String.format("%.1f MB", mb)
        }
    }
}
