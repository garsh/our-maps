package com.google.ourmaps.utils

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.content.ContentValues

class OfflineDatabase(context: Context) : SQLiteOpenHelper(context, "offline_maps.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        // Tile Manifest for resumable sync
        db.execSQL("""
            CREATE TABLE tile_manifest (
                url TEXT PRIMARY KEY,
                map_id TEXT NOT NULL,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                z INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                updated_at INTEGER NOT NULL
            )
        """)
        db.execSQL("CREATE INDEX idx_map_status ON tile_manifest(map_id, status)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    fun addToManifest(mapId: String, tiles: List<Triple<Int, Int, Int>>, urlTemplate: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val subdomains = listOf("a", "b", "c")
            tiles.forEach { (x, y, z) ->
                val s = subdomains[(x + y) % subdomains.size]
                val url = urlTemplate.replace("{s}", s).replace("{z}", z.toString()).replace("{x}", x.toString()).replace("{y}", y.toString())
                
                val values = ContentValues().apply {
                    put("url", url)
                    put("map_id", mapId)
                    put("x", x)
                    put("y", y)
                    put("z", z)
                    put("status", "pending")
                    put("updated_at", System.currentTimeMillis())
                }
                db.insertWithOnConflict("tile_manifest", null, values, SQLiteDatabase.CONFLICT_IGNORE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun getPendingTiles(mapId: String): List<String> {
        val tiles = mutableListOf<String>()
        val db = readableDatabase
        val cursor = db.rawQuery("SELECT url FROM tile_manifest WHERE map_id = ? AND (status = 'pending' OR status = 'error')", arrayOf(mapId))
        while (cursor.moveToNext()) {
            tiles.add(cursor.getString(0))
        }
        cursor.close()
        return tiles
    }

    fun updateTileStatus(url: String, status: String) {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("status", status)
            put("updated_at", System.currentTimeMillis())
        }
        db.update("tile_manifest", values, "url = ?", arrayOf(url))
    }

    fun getManifestStats(mapId: String): Pair<Int, Int> {
        val db = readableDatabase
        var total = 0
        var completed = 0
        
        val cursor = db.rawQuery("SELECT status, COUNT(*) FROM tile_manifest WHERE map_id = ? GROUP BY status", arrayOf(mapId))
        while (cursor.moveToNext()) {
            val status = cursor.getString(0)
            val count = cursor.getInt(1)
            total += count
            if (status == "completed") completed = count
        }
        cursor.close()
        return Pair(total, completed)
    }
}
