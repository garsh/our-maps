package com.google.ourmaps.utils

import com.google.ourmaps.model.MapData
import com.google.ourmaps.model.Pin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream

@RunWith(RobolectricTestRunner::class)
class KmlHelperTest {

    @Test
    fun `parseKmlToMapData correctly parses map name and pins`() {
        val kmlContent = """
            <?xml version="1.0" encoding="UTF-8"?>
            <kml xmlns="http://www.opengis.net/kml/2.2">
              <Document>
                <name>Test KML Map</name>
                <Placemark>
                  <name>Pin 1</name>
                  <description>Description 1</description>
                  <Point>
                    <coordinates>10.0,20.0</coordinates>
                  </Point>
                </Placemark>
              </Document>
            </kml>
        """.trimIndent()

        val inputStream = ByteArrayInputStream(kmlContent.toByteArray())
        val mapData = KmlHelper.parseKmlToMapData(inputStream, "map1", "user1")

        assertEquals("Test KML Map", mapData.name)
        assertEquals(1, mapData.pins.size)
        assertEquals("Pin 1", mapData.pins[0].label)
        assertEquals("Description 1", mapData.pins[0].description)
        assertEquals(20.0, mapData.pins[0].lat, 0.001)
        assertEquals(10.0, mapData.pins[0].lng, 0.001)
    }

    @Test
    fun `generateKmlFromMapData produces valid KML`() {
        val pin = Pin(
            id = "pin1",
            lat = 20.0,
            lng = 10.0,
            label = "Pin 1",
            description = "Description 1",
            imageUrl = null,
            color = "blue",
            icon = "default",
            groupId = null,
            position = 0
        )
        val mapData = MapData(
            id = "map1",
            name = "Test Map",
            ownerId = "user1",
            ownerName = "User",
            ownerEmail = "user@test.com",
            groups = emptyList(),
            pins = listOf(pin),
            userRole = "owner",
            lastAccessedAt = null
        )

        val kmlOutput = KmlHelper.generateKmlFromMapData(mapData)

        assertTrue(kmlOutput.contains("<name>Test Map</name>"))
        assertTrue(kmlOutput.contains("<name>Pin 1</name>"))
        assertTrue(kmlOutput.contains("<coordinates>10.0,20.0</coordinates>"))
    }
}
