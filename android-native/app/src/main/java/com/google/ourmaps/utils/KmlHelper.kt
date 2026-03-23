package com.google.ourmaps.utils

import android.util.Xml
import com.google.ourmaps.model.MapData
import com.google.ourmaps.model.Pin
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlSerializer
import java.io.InputStream
import java.io.StringWriter

object KmlHelper {

    fun parseKmlToMapData(inputStream: InputStream, mapId: String, ownerId: String): MapData {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(inputStream, null)
        parser.nextTag()

        val pins = mutableListOf<Pin>()
        var mapName = "Imported Map"

        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            if (parser.eventType != XmlPullParser.START_TAG) continue
            
            when (parser.name) {
                "Document" -> {
                    // Look for name inside Document
                    while (parser.next() != XmlPullParser.END_TAG || parser.name != "Document") {
                        if (parser.eventType == XmlPullParser.START_TAG && parser.name == "name") {
                            mapName = readText(parser)
                        } else if (parser.eventType == XmlPullParser.START_TAG && parser.name == "Placemark") {
                            pins.add(readPlacemark(parser))
                        }
                    }
                }
                "Placemark" -> pins.add(readPlacemark(parser))
            }
        }

        return MapData(
            id = mapId,
            name = mapName,
            ownerId = ownerId,
            ownerName = null,
            ownerEmail = null,
            groups = emptyList(),
            pins = pins,
            userRole = "owner",
            lastAccessedAt = null
        )
    }

    private fun readPlacemark(parser: XmlPullParser): Pin {
        var label: String? = null
        var description: String? = null
        var lat = 0.0
        var lng = 0.0

        while (parser.next() != XmlPullParser.END_TAG || parser.name != "Placemark") {
            if (parser.eventType != XmlPullParser.START_TAG) continue

            when (parser.name) {
                "name" -> label = readText(parser)
                "description" -> description = readText(parser)
                "Point" -> {
                    while (parser.next() != XmlPullParser.END_TAG || parser.name != "Point") {
                        if (parser.eventType == XmlPullParser.START_TAG && parser.name == "coordinates") {
                            val coords = readText(parser).trim()
                            val parts = coords.split(",")
                            if (parts.size >= 2) {
                                lng = parts[0].toDoubleOrNull() ?: 0.0
                                lat = parts[1].toDoubleOrNull() ?: 0.0
                            }
                        }
                    }
                }
            }
        }

        return Pin(
            id = java.util.UUID.randomUUID().toString(),
            lat = lat,
            lng = lng,
            label = label ?: "Untitled Pin",
            description = description,
            imageUrl = null,
            color = "blue",
            icon = "default",
            groupId = null,
            position = 0
        )
    }

    private fun readText(parser: XmlPullParser): String {
        var result = ""
        if (parser.next() == XmlPullParser.TEXT) {
            result = parser.text
            parser.nextTag()
        }
        return result
    }

    fun generateKmlFromMapData(mapData: MapData): String {
        val serializer: XmlSerializer = Xml.newSerializer()
        val writer = StringWriter()
        serializer.setOutput(writer)
        serializer.startDocument("UTF-8", true)
        serializer.startTag("", "kml")
        serializer.attribute("", "xmlns", "http://www.opengis.net/kml/2.2")
        
        serializer.startTag("", "Document")
        
        serializer.startTag("", "name")
        serializer.text(mapData.name)
        serializer.endTag("", "name")

        for (pin in mapData.pins) {
            serializer.startTag("", "Placemark")
            
            serializer.startTag("", "name")
            serializer.text(pin.label ?: "")
            serializer.endTag("", "name")

            if (!pin.description.isNullOrEmpty()) {
                serializer.startTag("", "description")
                serializer.text(pin.description)
                serializer.endTag("", "description")
            }

            serializer.startTag("", "Point")
            serializer.startTag("", "coordinates")
            serializer.text("${pin.lng},${pin.lat}")
            serializer.endTag("", "coordinates")
            serializer.endTag("", "Point")

            serializer.endTag("", "Placemark")
        }

        serializer.endTag("", "Document")
        serializer.endTag("", "kml")
        serializer.endDocument()
        return writer.toString()
    }
}
