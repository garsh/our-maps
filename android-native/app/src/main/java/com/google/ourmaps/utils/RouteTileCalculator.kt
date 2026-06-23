package com.google.ourmaps.utils

import org.osmdroid.util.GeoPoint
import kotlin.math.*

object RouteTileCalculator {
    /**
     * Generates a list of tiles along a corridor connecting multiple points.
     * This ensures the "road between pins" is also cached for offline use.
     */
    fun getTilesAlongPath(points: List<GeoPoint>, zoom: Int, radiusDegrees: Double = 0.005): Set<Triple<Int, Int, Int>> {
        val uniqueTiles = mutableSetOf<Triple<Int, Int, Int>>()
        
        if (points.size < 2) return emptySet()

        for (i in 0 until points.size - 1) {
            val start = points[i]
            val end = points[i+1]
            
            // Interpolate points along the segment to ensure no gaps in tile coverage
            val distance = estimateDistance(start, end)
            val steps = (distance / 0.002).toInt().coerceAtLeast(5) // approx every 200m
            
            for (step in 0..steps) {
                val lat = start.latitude + (end.latitude - start.latitude) * (step.toDouble() / steps)
                val lng = start.longitude + (end.longitude - start.longitude) * (step.toDouble() / steps)
                
                // Add tiles in a small box around each interpolated point
                val boxTiles = getTilesInBox(lat + radiusDegrees, lng + radiusDegrees, lat - radiusDegrees, lng - radiusDegrees, zoom)
                uniqueTiles.addAll(boxTiles)
            }
        }
        
        return uniqueTiles
    }

    private fun getTilesInBox(north: Double, east: Double, south: Double, west: Double, zoom: Int): List<Triple<Int, Int, Int>> {
        val tiles = mutableListOf<Triple<Int, Int, Int>>()
        val xMin = lonToX(west, zoom)
        val xMax = lonToX(east, zoom)
        val yMin = latToY(north, zoom)
        val yMax = latToY(south, zoom)

        for (x in minOf(xMin, xMax)..maxOf(xMin, xMax)) {
            for (y in minOf(yMin, yMax)..maxOf(yMin, yMax)) {
                tiles.add(Triple(x, y, zoom))
            }
        }
        return tiles
    }

    private fun lonToX(lon: Double, zoom: Int): Int {
        return floor((lon + 180.0) / 360.0 * (1 shl zoom)).toInt()
    }

    private fun latToY(lat: Double, zoom: Int): Int {
        val latRad = Math.toRadians(lat)
        return floor((1.0 - ln(tan(latRad) + 1.0 / cos(latRad)) / PI) / 2.0 * (1 shl zoom)).toInt()
    }

    private fun estimateDistance(p1: GeoPoint, p2: GeoPoint): Double {
        return sqrt((p1.latitude - p2.latitude).pow(2) + (p1.longitude - p2.longitude).pow(2))
    }
}
