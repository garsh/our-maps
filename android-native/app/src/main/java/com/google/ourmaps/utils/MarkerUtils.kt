package com.google.ourmaps.utils

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.drawable.Drawable
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.DrawableCompat
import com.google.ourmaps.R

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

        val size = 64 // Reduced from 96
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = android.graphics.Paint()
        paint.isAntiAlias = true
        
        // Draw Pin Drop Shape (matching web app more closely)
        paint.color = color
        paint.style = android.graphics.Paint.Style.FILL
        
        val pinPath = android.graphics.Path()
        val centerX = size / 2f
        val topY = size / 5f // Adjusted for smaller size
        val radius = size / 3.5f // Adjusted for smaller size
        
        pinPath.addCircle(centerX, topY + radius, radius, android.graphics.Path.Direction.CW)
        
        // Pointy bit
        val trianglePath = android.graphics.Path()
        trianglePath.moveTo(centerX - radius * 0.9f, topY + radius * 1.4f)
        trianglePath.lineTo(centerX + radius * 0.9f, topY + radius * 1.4f)
        trianglePath.lineTo(centerX, size.toFloat() - 5f) // Adjusted for smaller size
        trianglePath.close()
        canvas.drawPath(trianglePath, paint)
        canvas.drawCircle(centerX, topY + radius, radius, paint)

        // Draw White Circle for Icon
        paint.color = Color.WHITE
        canvas.drawCircle(centerX, topY + radius, radius * 0.75f, paint)
        
        // Draw Icon
        if (iconType != null && iconType != "default") {
            paint.color = color
            paint.style = android.graphics.Paint.Style.STROKE
            paint.strokeWidth = 3f // Reduced from 4f
            paint.strokeCap = android.graphics.Paint.Cap.ROUND
            paint.strokeJoin = android.graphics.Paint.Join.ROUND
            
            val iconScale = size / 96f // Scale factor relative to original design
            val icX = centerX
            val icY = topY + radius
            
            when (iconType) {
                "hotel" -> {
                    // Bed
                    canvas.drawLine(icX - 10f * iconScale, icY + 7f * iconScale, icX - 10f * iconScale, icY - 7f * iconScale, paint)
                    canvas.drawLine(icX + 10f * iconScale, icY + 7f * iconScale, icX + 10f * iconScale, icY + 1f * iconScale, paint)
                    canvas.drawLine(icX - 10f * iconScale, icY + 3f * iconScale, icX + 10f * iconScale, icY + 3f * iconScale, paint)
                }
                "restaurant" -> {
                    // Simplified Fork and Knife
                    canvas.drawLine(icX - 5f, icY - 8f, icX - 5f, icY + 8f, paint)
                    canvas.drawLine(icX + 5f, icY - 8f, icX + 5f, icY + 8f, paint)
                }
                "airport" -> {
                    // Plane (simplified)
                    val p = android.graphics.Path()
                    p.moveTo(icX, icY - 12f)
                    p.lineTo(icX - 12f, icY + 2f)
                    p.lineTo(icX + 12f, icY + 2f)
                    p.close()
                    canvas.drawPath(p, paint)
                }
                "park" -> {
                    // Simplified Tree
                    canvas.drawCircle(icX, icY - 2f, 8f, paint)
                    canvas.drawLine(icX, icY + 6f, icX, icY + 12f, paint)
                }
                "museum" -> {
                    // Simplified Temple
                    canvas.drawRect(icX - 10f, icY + 5f, icX + 10f, icY + 8f, paint)
                    canvas.drawLine(icX - 8f, icY + 5f, icX - 8f, icY - 4f, paint)
                    canvas.drawLine(icX + 8f, icY + 5f, icX + 8f, icY - 4f, paint)
                }
                "shopping" -> {
                    // Simplified Bag
                    canvas.drawRect(icX - 8f, icY - 4f, icX + 8f, icY + 8f, paint)
                }
                "camera" -> {
                    // Simplified Camera
                    canvas.drawRect(icX - 10f, icY - 5f, icX + 10f, icY + 7f, paint)
                    canvas.drawCircle(icX, icY + 1f, 4f, paint)
                }
                "gas" -> {
                    // Simplified Gas
                    canvas.drawRect(icX - 7f, icY - 6f, icX + 7f, icY + 8f, paint)
                }
                "charging" -> {
                    // Lightning Bolt
                    val p = android.graphics.Path()
                    p.moveTo(icX + 1f, icY - 10f)
                    p.lineTo(icX - 6f, icY + 1f)
                    p.lineTo(icX + 1f, icY + 1f)
                    p.lineTo(icX - 1f, icY + 10f)
                    p.lineTo(icX + 6f, icY - 1f)
                    p.lineTo(icX - 1f, icY - 1f)
                    p.close()
                    canvas.drawPath(p, paint)
                }
                else -> {
                    paint.style = android.graphics.Paint.Style.FILL
                    canvas.drawCircle(icX, icY, 4f, paint)
                }
            }
        } else {
            // Default: just a small colored dot
            paint.color = color.let { 
                Color.argb(180, Color.red(it), Color.green(it), Color.blue(it))
            }
            paint.style = android.graphics.Paint.Style.FILL
            canvas.drawCircle(centerX, topY + radius, radius * 0.25f, paint)
        }

        return android.graphics.drawable.BitmapDrawable(context.resources, bitmap)
    }

    fun drawableToBitmap(drawable: Drawable): Bitmap {
        if (drawable is android.graphics.drawable.BitmapDrawable) {
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
