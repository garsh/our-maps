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
                    else -> if (colorHex.startsWith("#")) Color.parseColor(colorHex) else defaultColor
                }
            }
        } catch (e: Exception) {
            defaultColor
        }

        val size = 96
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = android.graphics.Paint()
        paint.isAntiAlias = true
        
        // Draw Pin Drop Shape (matching web app more closely)
        paint.color = color
        paint.style = android.graphics.Paint.Style.FILL
        
        val pinPath = android.graphics.Path()
        val centerX = size / 2f
        val topY = size / 4f
        val radius = size / 3f
        
        pinPath.addCircle(centerX, topY + radius, radius, android.graphics.Path.Direction.CW)
        
        // Pointy bit
        val trianglePath = android.graphics.Path()
        trianglePath.moveTo(centerX - radius * 0.8f, topY + radius * 1.5f)
        trianglePath.lineTo(centerX + radius * 0.8f, topY + radius * 1.5f)
        trianglePath.lineTo(centerX, size.toFloat() - 10f)
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
            paint.strokeWidth = 4f
            paint.strokeCap = android.graphics.Paint.Cap.ROUND
            paint.strokeJoin = android.graphics.Paint.Join.ROUND
            
            val iconRadius = radius * 0.45f
            val icX = centerX
            val icY = topY + radius
            
            when (iconType) {
                "hotel" -> {
                    // Bed
                    canvas.drawLine(icX - 15f, icY + 10f, icX - 15f, icY - 10f, paint) // Left post
                    canvas.drawLine(icX + 15f, icY + 10f, icX + 15f, icY + 2f, paint) // Right post
                    canvas.drawLine(icX - 15f, icY + 5f, icX + 15f, icY + 5f, paint) // Mattress
                    canvas.drawRect(icX - 12f, icY - 5f, icX - 2f, icY + 2f, paint) // Pillow
                }
                "restaurant" -> {
                    // Fork and Knife
                    // Fork
                    canvas.drawLine(icX - 8f, icY - 12f, icX - 8f, icY + 12f, paint)
                    canvas.drawLine(icX - 12f, icY - 12f, icX - 12f, icY - 4f, paint)
                    canvas.drawLine(icX - 4f, icY - 12f, icX - 4f, icY - 4f, paint)
                    canvas.drawLine(icX - 12f, icY - 4f, icX - 4f, icY - 4f, paint)
                    // Knife
                    canvas.drawLine(icX + 8f, icY - 12f, icX + 8f, icY + 12f, paint)
                    canvas.drawArc(icX + 4f, icY - 12f, icX + 12f, icY, 180f, 180f, false, paint)
                }
                "airport" -> {
                    // Plane
                    val p = android.graphics.Path()
                    p.moveTo(icX, icY - 18f) // Nose
                    p.lineTo(icX - 3f, icY - 12f)
                    p.lineTo(icX - 18f, icY + 2f) // Left wing tip
                    p.lineTo(icX - 18f, icY + 5f)
                    p.lineTo(icX - 3f, icY + 2f)
                    p.lineTo(icX - 3f, icY + 12f)
                    p.lineTo(icX - 8f, icY + 16f) // Left tail tip
                    p.lineTo(icX + 8f, icY + 16f) // Right tail tip
                    p.lineTo(icX + 3f, icY + 12f)
                    p.lineTo(icX + 3f, icY + 2f)
                    p.lineTo(icX + 18f, icY + 5f)
                    p.lineTo(icX + 18f, icY + 2f) // Right wing tip
                    p.lineTo(icX + 3f, icY - 12f)
                    p.close()
                    canvas.drawPath(p, paint)
                }
                "park" -> {
                    // Tree
                    val p = android.graphics.Path()
                    // Top triangle
                    p.moveTo(icX, icY - 15f)
                    p.lineTo(icX - 12f, icY - 2f)
                    p.lineTo(icX + 12f, icY - 2f)
                    p.close()
                    // Middle triangle
                    p.moveTo(icX, icY - 5f)
                    p.lineTo(icX - 15f, icY + 8f)
                    p.lineTo(icX + 15f, icY + 8f)
                    p.close()
                    canvas.drawPath(p, paint)
                    // Trunk
                    canvas.drawRect(icX - 3f, icY + 8f, icX + 3f, icY + 15f, paint)
                }
                "museum" -> {
                    // Temple/Museum
                    canvas.drawRect(icX - 15f, icY + 8f, icX + 15f, icY + 12f, paint) // Base
                    canvas.drawLine(icX - 12f, icY + 8f, icX - 12f, icY - 5f, paint) // Column 1
                    canvas.drawLine(icX, icY + 8f, icX, icY - 5f, paint) // Column 2
                    canvas.drawLine(icX + 12f, icY + 8f, icX + 12f, icY - 5f, paint) // Column 3
                    val p = android.graphics.Path()
                    p.moveTo(icX - 18f, icY - 5f)
                    p.lineTo(icX, icY - 15f)
                    p.lineTo(icX + 18f, icY - 5f)
                    p.close()
                    canvas.drawPath(p, paint)
                }
                "shopping" -> {
                    // Bag
                    canvas.drawRect(icX - 12f, icY - 5f, icX + 12f, icY + 12f, paint)
                    canvas.drawArc(icX - 8f, icY - 12f, icX + 8f, icY, 180f, 180f, false, paint)
                }
                "camera" -> {
                    // Camera
                    canvas.drawRect(icX - 15f, icY - 8f, icX + 15f, icY + 10f, paint)
                    canvas.drawCircle(icX, icY + 1f, 6f, paint)
                    canvas.drawRect(icX - 10f, icY - 12f, icX - 2f, icY - 8f, paint)
                }
                else -> {
                    paint.style = android.graphics.Paint.Style.FILL
                    canvas.drawCircle(icX, icY, 6f, paint)
                }
            }
        } else {
            // Default: just a small colored dot
            paint.color = color.let { 
                // Lighten the color for the dot
                Color.argb(150, Color.red(it), Color.green(it), Color.blue(it))
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
