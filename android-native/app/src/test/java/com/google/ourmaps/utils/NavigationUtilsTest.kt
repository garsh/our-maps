package com.google.ourmaps.utils

import com.google.ourmaps.model.Pin
import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationUtilsTest {

    @Test
    fun testGenerateNavigationUri_SinglePin_CurrentLocation() {
        val pins = listOf(
            Pin("1", 10.0, 20.0, "Pin 1", null, null, null, "blue", "default", null, 0)
        )
        val uri = NavigationUtils.generateNavigationUri(pins, useCurrentLocation = true)
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=10.0,20.0&waypoints=&travelmode=driving", uri)
    }

    @Test
    fun testGenerateNavigationUri_SinglePin_Search() {
        val pins = listOf(
            Pin("1", 10.0, 20.0, "Pin 1", null, null, null, "blue", "default", null, 0)
        )
        val uri = NavigationUtils.generateNavigationUri(pins, useCurrentLocation = false)
        assertEquals("https://www.google.com/maps/search/?api=1&query=10.0,20.0", uri)
    }

    @Test
    fun testGenerateNavigationUri_MultiplePins_CurrentLocation() {
        val pins = listOf(
            Pin("1", 10.0, 20.0, "Pin 1", null, null, null, "blue", "default", null, 0),
            Pin("2", 30.0, 40.0, "Pin 2", null, null, null, "red", "default", null, 1),
            Pin("3", 50.0, 60.0, "Pin 3", null, null, null, "green", "default", null, 2)
        )
        val uri = NavigationUtils.generateNavigationUri(pins, useCurrentLocation = true)
        // Destination should be the last pin, waypoints should be all but the last
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=50.0,60.0&waypoints=10.0,20.0|30.0,40.0&travelmode=driving", uri)
    }

    @Test
    fun testGenerateNavigationUri_MultiplePins_FirstPinOrigin() {
        val pins = listOf(
            Pin("1", 10.0, 20.0, "Pin 1", null, null, null, "blue", "default", null, 0),
            Pin("2", 30.0, 40.0, "Pin 2", null, null, null, "red", "default", null, 1),
            Pin("3", 50.0, 60.0, "Pin 3", null, null, null, "green", "default", null, 2)
        )
        val uri = NavigationUtils.generateNavigationUri(pins, useCurrentLocation = false)
        // Origin should be first pin, Destination should be last pin, waypoints should be middle pins
        assertEquals("https://www.google.com/maps/dir/?api=1&origin=10.0,20.0&destination=50.0,60.0&waypoints=30.0,40.0&travelmode=driving", uri)
    }

    @Test
    fun testGenerateNavigationUri_Empty() {
        val pins = emptyList<Pin>()
        val uri = NavigationUtils.generateNavigationUri(pins)
        assertEquals("", uri)
    }
}
