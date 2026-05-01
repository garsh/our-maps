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
        val groups = mutableListOf<com.google.ourmaps.model.PinGroup>()
        var mapName = "Imported Map"

        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            if (parser.eventType != XmlPullParser.START_TAG) continue
            
            if (parser.name == "Document" || parser.name == "Folder" || parser.name == "kml") {
                parseContainer(parser, pins, groups, null, if (parser.name == "Document") { name -> mapName = name } else null)
            }
        }

        return MapData(
            id = mapId,
            name = mapName,
            ownerId = ownerId,
            ownerName = null,
            ownerEmail = null,
            groups = groups,
            pins = pins,
            userRole = null,
            permissions = null,
            lastAccessedAt = null
            )
    }

    private fun parseContainer(
        parser: XmlPullParser,
        pins: MutableList<Pin>,
        groups: MutableList<com.google.ourmaps.model.PinGroup>,
        currentGroupId: String?,
        onNameFound: ((String) -> Unit)?
    ) {
        while (parser.next() != XmlPullParser.END_TAG) {
            if (parser.eventType != XmlPullParser.START_TAG) continue

            when (parser.name) {
                "name" -> {
                    val name = readText(parser)
                    onNameFound?.invoke(name)
                }
                "Folder" -> {
                    // Extract folder name first if possible or handle inside
                    // For simplicity in this stream parser, we might miss the name if it's after other tags.
                    // A proper DOM parser is often better for KML, but recursive Pull is okay if structure is standard.
                    // We'll Create a group for this folder.
                    val newGroupId = java.util.UUID.randomUUID().toString()
                    // We need to find the name of this folder.
                    // This recursion is tricky with PullParser. 
                    // Let's simplified: If we hit Folder, we create a group and recurse.
                    // The name might be the first child.
                    
                    var folderName = "Untitled Group"
                    // We need to peek or just start parsing children.
                    // Let's assume standard KML: <Folder><name>...</name>...
                    
                    val tempPins = mutableListOf<Pin>() // We might need to assign them later
                    
                    // Actually, let's just make a new group and update its name if we find one.
                    val group = com.google.ourmaps.model.PinGroup(newGroupId, folderName, groups.size)
                    groups.add(group)
                    
                    parseContainer(parser, pins, groups, newGroupId) { name -> 
                        // Update group name in the list (mutable)
                        val index = groups.indexOf(group)
                        if (index != -1) {
                            groups[index] = group.copy(name = name)
                        }
                    }
                }
                "Placemark" -> {
                    pins.add(readPlacemark(parser).copy(groupId = currentGroupId))
                }
                else -> skip(parser)
            }
        }
    }

    private fun skip(parser: XmlPullParser) {
        if (parser.eventType != XmlPullParser.START_TAG) {
            throw IllegalStateException()
        }
        var depth = 1
        while (depth != 0) {
            when (parser.next()) {
                XmlPullParser.END_TAG -> depth--
                XmlPullParser.START_TAG -> depth++
            }
        }
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
            address = null,
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
