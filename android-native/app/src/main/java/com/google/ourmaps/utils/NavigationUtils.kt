package com.google.ourmaps.utils

import com.google.ourmaps.model.Pin

object NavigationUtils {
    fun generateNavigationUri(selectedPins: List<Pin>): String {
        if (selectedPins.isEmpty()) return ""
        
        val destination = selectedPins.last()
        val waypoints = if (selectedPins.size > 1) {
            selectedPins.subList(0, selectedPins.size - 1).joinToString("|") { "${it.lat},${it.lng}" }
        } else ""
        
        return "https://www.google.com/maps/dir/?api=1&origin=current+location&destination=${destination.lat},${destination.lng}&waypoints=$waypoints&travelmode=driving&dir_action=navigate"
    }
}
