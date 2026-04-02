package com.google.ourmaps.services

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.google.gson.Gson
import com.google.ourmaps.model.MapData
import com.google.ourmaps.model.Pin
import com.google.ourmaps.utils.*
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.tileprovider.tilesource.TileSourcePolicy
import org.osmdroid.util.BoundingBox

class MapDownloadService : Service() {
    private val gson = Gson()
    private val activeDownloaders = mutableMapOf<String, SmartMapDownloader>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val mapJson = intent?.getStringExtra("map_data")
        val bboxJson = intent?.getStringExtra("bounding_box")
        
        if (mapJson != null && bboxJson != null) {
            val mapData = gson.fromJson(mapJson, MapData::class.java)
            val bbox = gson.fromJson(bboxJson, BBoxData::class.java).toBoundingBox()
            
            startDownload(mapData, bbox)
        }
        
        return START_NOT_STICKY
    }

    private fun startDownload(mapData: MapData, bbox: BoundingBox) {
        if (activeDownloaders.containsKey(mapData.id)) return

        Log.i("MapDownloadService", "Starting background download for ${mapData.name}")
        
        val tileSource = XYTileSource(
            "OpenStreetMap",
            0, 19, 256, ".png", 
            arrayOf("https://tile.openstreetmap.org/"),
            "© OpenStreetMap contributors",
            TileSourcePolicy(2, TileSourcePolicy.FLAG_USER_AGENT_MEANINGFUL or TileSourcePolicy.FLAG_USER_AGENT_NORMALIZED)
        )

        val downloader = SmartMapDownloader(
            context = this,
            tileSource = tileSource,
            mapName = mapData.name,
            onProgress = { progress ->
                DownloadProgressTracker.updateProgress(mapData.id, progress)
                NotificationHelper.showDownloadNotification(this, mapData.name, progress)
            },
            onComplete = {
                Log.i("MapDownloadService", "Download complete for ${mapData.name}")
                OfflineManager.saveMapOffline(this, mapData)
                activeDownloaders.remove(mapData.id)
                DownloadProgressTracker.completeDownload(mapData.id)
                checkFinished()
            },
            onError = { message ->
                Log.e("MapDownloadService", "Download failed for ${mapData.name}: $message")
                NotificationHelper.showFailureNotification(this, mapData.name)
                activeDownloaders.remove(mapData.id)
                DownloadProgressTracker.completeDownload(mapData.id)
                checkFinished()
            }
        )

        activeDownloaders[mapData.id] = downloader
        
        // Start foreground service with notification
        val notification = NotificationHelper.showDownloadNotification(this, mapData.name, 0f)
        startForeground(NotificationHelper.NOTIFICATION_ID, notification)
        
        downloader.downloadMap(mapData.pins, bbox)
    }

    private fun checkFinished() {
        if (activeDownloaders.isEmpty()) {
            stopSelf()
        }
    }

    data class BBoxData(val n: Double, val e: Double, val s: Double, val w: Double) {
        fun toBoundingBox() = BoundingBox(n, e, s, w)
    }
}
