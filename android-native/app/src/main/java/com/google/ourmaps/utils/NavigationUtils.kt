package com.google.ourmaps.utils

import com.google.ourmaps.model.Pin

object NavigationUtils {
    fun generateNavigationUri(selectedPins: List<Pin>, useCurrentLocation: Boolean = true): String {
        if (selectedPins.isEmpty()) return ""
        
        return if (useCurrentLocation) {
            val destination = selectedPins.last()
            val waypoints = if (selectedPins.size > 1) {
                selectedPins.subList(0, selectedPins.size - 1).joinToString("|") { "${it.lat},${it.lng}" }
            } else ""
            
            "https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&waypoints=$waypoints&travelmode=driving"
        } else {
            // If not starting from current location, use the first pin as origin
            if (selectedPins.size < 2) {
                // Just search for the single pin
                "https://www.google.com/maps/search/?api=1&query=${selectedPins[0].lat},${selectedPins[0].lng}"
            } else {
                val origin = selectedPins.first()
                val destination = selectedPins.last()
                val waypoints = if (selectedPins.size > 2) {
                    selectedPins.subList(1, selectedPins.size - 1).joinToString("|") { "${it.lat},${it.lng}" }
                } else ""
                
                "https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&waypoints=$waypoints&travelmode=driving"
            }
        }
    }
}
