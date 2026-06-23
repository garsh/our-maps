package com.google.ourmaps.utils

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.Drawable
import androidx.core.graphics.PathParser
import android.graphics.drawable.BitmapDrawable

object MarkerUtils {

    fun getColoredMarker(context: Context, colorHex: String?, iconType: String? = "default"): Drawable? {
        val defaultColor = Color.parseColor("#2A81CB") // Blue
        val color = try {
            if (colorHex.isNullOrEmpty()) defaultColor else {
                when (colorHex.lowercase()) {
                    "blue" -> Color.parseColor("#2A81CB")
                    "red" -> Color.parseColor("#CB2B3E")
                    "green" -> Color.parseColor("#2AAD27")
                    "orange" -> Color.parseColor("#CB8427")
                    "violet" -> Color.parseColor("#9C2BCB")
                    "gold", "yellow" -> Color.parseColor("#FFD700")
                    "pink" -> Color.parseColor("#FF69B4")
                    "teal" -> Color.parseColor("#008080")
                    "brown" -> Color.parseColor("#8B4513")
                    else -> if (colorHex.startsWith("#")) Color.parseColor(colorHex) else defaultColor
                }
            }
        } catch (e: Exception) {
            defaultColor
        }

        val size = 64 
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = android.graphics.Paint()
        paint.isAntiAlias = true
        
        // Draw Pin Drop Shape
        paint.color = color
        paint.style = android.graphics.Paint.Style.FILL
        
        val centerX = size / 2f
        val topY = size / 5f 
        val radius = size / 3.5f 
        
        // Pointy bit
        val trianglePath = android.graphics.Path()
        trianglePath.moveTo(centerX - radius * 0.9f, topY + radius * 1.4f)
        trianglePath.lineTo(centerX + radius * 0.9f, topY + radius * 1.4f)
        trianglePath.lineTo(centerX, size.toFloat() - 5f) 
        trianglePath.close()
        canvas.drawPath(trianglePath, paint)
        canvas.drawCircle(centerX, topY + radius, radius, paint)

        // Draw Icon OR Default white dot
        if (iconType != null && iconType != "default") {
            // Draw White Circle for Icon background
            paint.color = Color.WHITE
            canvas.drawCircle(centerX, topY + radius, radius * 0.9f, paint)

            // Draw Icon using SVG Path
            val pathData = when (iconType) {
                "hotel" -> "M20 10V7c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10h2v-2h16v2h2v-5c0-1.1-.9-2-2-2zm-10 4H4v-4h6v4z"
                "restaurant" -> "M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"
                "airport" -> "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
                "park" -> "M17 12h2L12 2 5.05 12h1.97l-4.66 6h6.06v3h3.15v-3h6.06l-4.63-6z"
                "museum" -> "M12 1L3 5v2h18V5l-9-4zm-9 18h18v2H3v-2zm3-10v7h2v-7H6zm5 0v7h2v-7h-2zm5 0v7h2v-7h-2z"
                "shopping" -> "M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-8 4c0 .55-.45 1-1 1s-1-.45-1-1V8h2v2zm4-4h-4c0-1.1.9-2 2-2s2 .9 2 2zm0 4c0 .55-.45 1-1 1s-1-.45-1-1V8h2v2z"
                "camera" -> "M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"
                "gas" -> "M19.77,7.23l.01-.01-3.72-3.72L15,4.56l2.11,2.11c-.94.36-1.61,1.26-1.61,2.33 0,1.38,1.12,2.5,2.5,2.5.36,0,.69-.08,1-.22v7.72c0,.55-.45,1-1,1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H4c-1.1,0-2,.9-2,2v16h10v-7.5h1v7.5c0,1.1.9,2,2,2s2-.9,2-2v-7h1v7c0,2.21,1.79,4,4,4s4-1.79,4-4V9c0-.69-.28-1.32-.73-1.77zM18,10c-.55,0-1-.45-1-1s.45-1,1-1,1,.45,1,1-.45,1-1,1z"
                "charging" -> "M13 2L3 14h9l-1 8L21 10h-9l1-8z"
                else -> ""
            }

            if (pathData.isNotEmpty()) {
                try {
                    val path = PathParser.createPathFromPathData(pathData)
                    val pathBounds = android.graphics.RectF()
                    path.computeBounds(pathBounds, true)
                    
                    val matrix = android.graphics.Matrix()
                    // Increased scale: fill most of the white circle
                    val targetSize = radius * 1.05f 
                    val scale = targetSize / Math.max(pathBounds.width(), pathBounds.height())
                    
                    matrix.postTranslate(-pathBounds.centerX(), -pathBounds.centerY())
                    matrix.postScale(scale, scale)
                    matrix.postTranslate(centerX, topY + radius)
                    path.transform(matrix)

                    paint.color = color
                    paint.style = android.graphics.Paint.Style.FILL
                    canvas.drawPath(path, paint)
                } catch (e: Exception) {
                    paint.color = color
                    canvas.drawCircle(centerX, topY + radius, 4f, paint)
                }
            }
        } else {
            // Default pin: Solid color with a small white circle in the center
            paint.color = Color.WHITE
            canvas.drawCircle(centerX, topY + radius, radius * 0.25f, paint)
        }

        return BitmapDrawable(context.resources, bitmap)
    }

    fun drawableToBitmap(drawable: Drawable): Bitmap {
        if (drawable is BitmapDrawable) {
            return drawable.bitmap
        }
        val bitmap = Bitmap.createBitmap(
            drawable.intrinsicWidth.coerceAtLeast(1),
            drawable.intrinsicHeight.coerceAtLeast(1),
            Bitmap.Config.ARGB_8888
        )
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }
}
