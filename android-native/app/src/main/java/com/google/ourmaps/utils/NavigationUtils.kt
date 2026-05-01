package com.google.ourmaps.utils

import com.google.ourmaps.model.Pin

object NavigationUtils {
    fun generateNavigationUri(selectedPins: List<Pin>): String {
        if (selectedPins.isEmpty()) return ""
        
        val destination = selectedPins.last()
        val waypoints = if (selectedPins.size > 1) {
            selectedPins.subList(0, selectedPins.size - 1).joinToString("|") { "${it.lat},${it.lng}" }
        } else ""
        
        // destination and waypoints are enough, Google Maps will default to current location as origin if omitted
        return "https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&waypoints=$waypoints&travelmode=driving"
    }
}
