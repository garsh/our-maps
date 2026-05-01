package com.google.ourmaps.utils

import com.google.ourmaps.model.Pin
import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationUtilsTest {

    @Test
    fun testGenerateNavigationUri_SinglePin() {
        val pins = listOf(
            Pin("1", 10.0, 20.0, "Pin 1", null, null, null, "blue", "default", null, 0)
        )
        val uri = NavigationUtils.generateNavigationUri(pins)
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=10.0,20.0&waypoints=&travelmode=driving", uri)
    }

    @Test
    fun testGenerateNavigationUri_MultiplePins() {
        val pins = listOf(
            Pin("1", 10.0, 20.0, "Pin 1", null, null, null, "blue", "default", null, 0),
            Pin("2", 30.0, 40.0, "Pin 2", null, null, null, "red", "default", null, 1),
            Pin("3", 50.0, 60.0, "Pin 3", null, null, null, "green", "default", null, 2)
        )
        val uri = NavigationUtils.generateNavigationUri(pins)
        // Destination should be the last pin, waypoints should be all but the last
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=50.0,60.0&waypoints=10.0,20.0|30.0,40.0&travelmode=driving", uri)
    }

    @Test
    fun testGenerateNavigationUri_Empty() {
        val pins = emptyList<Pin>()
        val uri = NavigationUtils.generateNavigationUri(pins)
        assertEquals("", uri)
    }
}
