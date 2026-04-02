package com.google.ourmaps.utils

import android.content.Context
import android.util.Log
import com.google.ourmaps.model.Pin
import org.osmdroid.tileprovider.cachemanager.CacheManager
import org.osmdroid.tileprovider.tilesource.ITileSource
import org.osmdroid.tileprovider.MapTileProviderBasic
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import kotlin.math.abs

class SmartMapDownloader(
    private val context: Context,
    private val tileSource: ITileSource,
    private val mapName: String,
    private val onProgress: (Float) -> Unit,
    private val onComplete: () -> Unit,
    private val onError: (String) -> Unit
) {
    private val tileProvider = MapTileProviderBasic(context, tileSource)
    private val cacheManager = CacheManager(tileProvider, tileProvider.tileWriter, 0, 22)
    private val queue = mutableListOf<DownloadTask>()
    private var totalTasks = 0
    private var completedTasks = 0
    private var runningTasks = 0
    private val maxConcurrentTasks = 3

    data class DownloadTask(val box: BoundingBox, val minZoom: Int, val maxZoom: Int)

    fun downloadMap(pins: List<Pin>, mainBoundingBox: BoundingBox) {
        queue.clear()
        completedTasks = 0
        runningTasks = 0

        // 1. Low detail for the whole area
        queue.add(DownloadTask(mainBoundingBox, 1, 10))

        // 2. Cluster pins to merge overlapping areas
        val highDetailBoxes = mutableListOf<BoundingBox>()
        pins.forEach { pin ->
            val p = GeoPoint(pin.lat, pin.lng)
            val newBox = BoundingBox(p.latitude + 0.005, p.longitude + 0.005, p.latitude - 0.005, p.longitude - 0.005)
            
            var merged = false
            for (i in highDetailBoxes.indices) {
                if (shouldMerge(highDetailBoxes[i], newBox)) {
                    highDetailBoxes[i] = mergeBoxes(highDetailBoxes[i], newBox)
                    merged = true
                    break
                }
            }
            if (!merged) highDetailBoxes.add(newBox)
        }

        highDetailBoxes.forEach { box ->
            queue.add(DownloadTask(box, 11, 16))
        }

        totalTasks = queue.size
        Log.i("SmartMapDownloader", "Starting $totalTasks surgical download tasks")
        
        NotificationHelper.showDownloadNotification(context, mapName, 0f)
        
        repeat(maxConcurrentTasks) {
            processNextTask()
        }
    }

    private fun shouldMerge(b1: BoundingBox, b2: BoundingBox): Boolean {
        val latCenterDist = abs(b1.centerWithDateLine.latitude - b2.centerWithDateLine.latitude)
        val lngCenterDist = abs(b1.centerWithDateLine.longitude - b2.centerWithDateLine.longitude)
        return latCenterDist < 0.02 && lngCenterDist < 0.02
    }

    private fun mergeBoxes(b1: BoundingBox, b2: BoundingBox): BoundingBox {
        return BoundingBox(
            maxOf(b1.latNorth, b2.latNorth),
            maxOf(b1.lonEast, b2.lonEast),
            minOf(b1.latSouth, b2.latSouth),
            minOf(b1.lonWest, b2.lonWest)
        )
    }

    @Synchronized
    private fun processNextTask() {
        if (queue.isEmpty()) {
            if (runningTasks == 0) {
                NotificationHelper.showCompleteNotification(context, mapName)
                tileProvider.detach()
                onComplete()
            }
            return
        }

        if (runningTasks >= maxConcurrentTasks) return

        val task = queue.removeAt(0)
        runningTasks++
        
        // Use downloadAreaAsync with context
        cacheManager.downloadAreaAsync(context, task.box, task.minZoom, task.maxZoom, object : CacheManager.CacheManagerCallback {
            override fun onTaskComplete() {
                taskFinished()
            }

            override fun onTaskFailed(errors: Int) {
                taskFinished()
            }

            override fun updateProgress(progress: Int, currentZoomLevel: Int, zoomMin: Int, zoomMax: Int) {
                val taskProgress = (progress.toFloat() / 1000f).coerceIn(0f, 0.9f)
                val currentOverallProgress = (completedTasks.toFloat() + taskProgress) / totalTasks.toFloat()
                val clamped = currentOverallProgress.coerceIn(0f, 1f)
                onProgress(clamped)
                NotificationHelper.showDownloadNotification(context, mapName, clamped)
            }

            override fun setPossibleTilesInArea(total: Int) {}
            override fun downloadStarted() {}
        })
    }

    @Synchronized
    private fun taskFinished() {
        runningTasks--
        completedTasks++
        NotificationHelper.showDownloadNotification(context, mapName, completedTasks.toFloat() / totalTasks.toFloat())
        processNextTask()
    }
}
