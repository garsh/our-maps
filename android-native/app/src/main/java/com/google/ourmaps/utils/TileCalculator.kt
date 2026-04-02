package com.google.ourmaps.utils

import org.osmdroid.util.BoundingBox
import kotlin.math.*

object TileCalculator {
    /**
     * Estimates the number of tiles in a bounding box for a range of zoom levels.
     */
    fun countTiles(box: BoundingBox, minZoom: Int, maxZoom: Int): Int {
        var total = 0
        for (zoom in minZoom..maxZoom) {
            val xMin = longToX(box.lonWest, zoom)
            val xMax = longToX(box.lonEast, zoom)
            val yMin = latToY(box.latNorth, zoom)
            val yMax = latToY(box.latSouth, zoom)
            
            total += (abs(xMax - xMin) + 1) * (abs(yMax - yMin) + 1)
        }
        return total
    }

    /**
     * Estimates size in MB based on tile count (avg 20KB per tile).
     */
    fun estimateSizeMB(tileCount: Int): Double {
        return (tileCount * 20.0) / 1024.0
    }

    private fun longToX(lon: Double, zoom: Int): Int {
        return floor((lon + 180.0) / 360.0 * (1 shl zoom)).toInt()
    }

    private fun latToY(lat: Double, zoom: Int): Int {
        val latRad = Math.toRadians(lat)
        return floor((1.0 - ln(tan(latRad) + 1.0 / cos(latRad)) / PI) / 2.0 * (1 shl zoom)).toInt()
    }
}
