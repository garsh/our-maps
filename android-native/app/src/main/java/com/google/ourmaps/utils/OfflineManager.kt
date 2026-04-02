package com.google.ourmaps.utils

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.ourmaps.model.MapData

object OfflineManager {
    private const val PREFS_NAME = "offline_maps"
    private const val KEY_DOWNLOADED_MAPS = "downloaded_map_ids"
    private const val KEY_MAP_DATA_PREFIX = "map_data_"
    private val gson = Gson()

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun saveMapOffline(context: Context, mapData: MapData) {
        val prefs = getPrefs(context)
        val downloaded = getDownloadedMaps(context).toMutableSet()
        downloaded.add(mapData.id)
        
        prefs.edit()
            .putStringSet(KEY_DOWNLOADED_MAPS, downloaded)
            .putString(KEY_MAP_DATA_PREFIX + mapData.id, gson.toJson(mapData))
            .apply()
    }

    fun isMapDownloaded(context: Context, mapId: String): Boolean {
        return getDownloadedMaps(context).contains(mapId)
    }

    fun getOfflineMap(context: Context, mapId: String): MapData? {
        val json = getPrefs(context).getString(KEY_MAP_DATA_PREFIX + mapId, null)
        return if (json != null) gson.fromJson(json, MapData::class.java) else null
    }

    fun getAllOfflineMaps(context: Context): List<MapData> {
        val downloadedIds = getDownloadedMaps(context)
        return downloadedIds.mapNotNull { getOfflineMap(context, it) }
    }

    fun removeOfflineMap(context: Context, mapId: String) {
        val prefs = getPrefs(context)
        val downloaded = getDownloadedMaps(context).toMutableSet()
        downloaded.remove(mapId)
        
        prefs.edit()
            .putStringSet(KEY_DOWNLOADED_MAPS, downloaded)
            .remove(KEY_MAP_DATA_PREFIX + mapId)
            .apply()
    }

    fun markMapAsDownloaded(context: Context, mapId: String) {
        val downloaded = getDownloadedMaps(context).toMutableSet()
        downloaded.add(mapId)
        getPrefs(context).edit().putStringSet(KEY_DOWNLOADED_MAPS, downloaded).apply()
    }

    private fun getDownloadedMaps(context: Context): Set<String> {
        return getPrefs(context).getStringSet(KEY_DOWNLOADED_MAPS, emptySet()) ?: emptySet()
    }
}
