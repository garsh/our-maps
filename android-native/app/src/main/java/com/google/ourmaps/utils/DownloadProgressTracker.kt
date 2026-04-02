package com.google.ourmaps.utils

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object DownloadProgressTracker {
    private val _downloadProgress = MutableStateFlow<Map<String, Float>>(emptyMap())
    val downloadProgress: StateFlow<Map<String, Float>> = _downloadProgress.asStateFlow()

    private val _activeDownloads = MutableStateFlow<Set<String>>(emptySet())
    val activeDownloads: StateFlow<Set<String>> = _activeDownloads.asStateFlow()

    fun updateProgress(mapId: String, progress: Float) {
        val current = _downloadProgress.value.toMutableMap()
        current[mapId] = progress
        _downloadProgress.value = current
        
        if (!_activeDownloads.value.contains(mapId)) {
            val active = _activeDownloads.value.toMutableSet()
            active.add(mapId)
            _activeDownloads.value = active
        }
    }

    fun completeDownload(mapId: String) {
        val active = _activeDownloads.value.toMutableSet()
        active.remove(mapId)
        _activeDownloads.value = active
        
        val current = _downloadProgress.value.toMutableMap()
        current.remove(mapId)
        _downloadProgress.value = current
    }
}
