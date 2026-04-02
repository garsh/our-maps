package com.google.ourmaps.ui

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.ourmaps.model.Pin
import com.google.ourmaps.ui.theme.DarkSlateBlue
import com.google.ourmaps.ui.theme.LightGray
import com.google.ourmaps.ui.theme.SuccessGreen
import com.google.ourmaps.utils.KmlHelper
import com.google.ourmaps.utils.MarkerUtils
import com.google.ourmaps.utils.OfflineManager
import com.google.ourmaps.utils.DownloadProgressTracker
import com.google.ourmaps.utils.TileCalculator
import com.google.ourmaps.services.MapDownloadService
import com.google.gson.Gson
import com.google.ourmaps.viewmodel.MapDetailViewModel
import com.google.ourmaps.viewmodel.UiState
import org.osmdroid.events.MapEventsReceiver
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.tileprovider.tilesource.TileSourcePolicy
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker
import java.io.OutputStream
import android.widget.Toast
import android.util.Log

data class DownloadSummary(val tileCount: Int, val sizeMB: Double, val bbox: BoundingBox)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapDetailScreen(
    mapId: String,
    viewModel: MapDetailViewModel,
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    
    // Custom TileSource that allows bulk downloading
    val permissiveTileSource = remember {
        XYTileSource(
            "OpenStreetMap",
            0, 19, 256, ".png", 
            arrayOf("https://tile.openstreetmap.org/"),
            "© OpenStreetMap contributors",
            TileSourcePolicy(2, TileSourcePolicy.FLAG_USER_AGENT_MEANINGFUL or TileSourcePolicy.FLAG_USER_AGENT_NORMALIZED)
        )
    }

    // Background download status
    val activeDownloads by DownloadProgressTracker.activeDownloads.collectAsState()
    val progressMap by DownloadProgressTracker.downloadProgress.collectAsState()
    
    val isDownloading = activeDownloads.contains(mapId)
    val downloadProgress = progressMap[mapId] ?: 0f

    var selectedPin by remember { mutableStateOf<Pin?>(null) }
    var showMenu by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    
    // Download confirmation
    var showDownloadConfirm by remember { mutableStateOf(false) }
    var downloadSummary by remember { mutableStateOf<DownloadSummary?>(null) }

    // Offline status
    var isOfflineAvailable by remember(mapId) { 
        mutableStateOf(OfflineManager.isMapDownloaded(context, mapId)) 
    }
    
    // Track if we've already auto-zoomed for the current map
    var hasAutoZoomed by remember(mapId) { mutableStateOf(false) }

    // Reference to MapView for downloading
    var mapViewRef by remember { mutableStateOf<MapView?>(null) }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/vnd.google-earth.kml+xml")
    ) { uri ->
        uri?.let {
            val state = uiState
            if (state is UiState.Success) {
                try {
                    val outputStream: OutputStream? = context.contentResolver.openOutputStream(it)
                    outputStream?.use { stream ->
                        val kmlContent = KmlHelper.generateKmlFromMapData(state.data)
                        stream.write(kmlContent.toByteArray())
                    }
                    Toast.makeText(context, "Map exported successfully", Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    e.printStackTrace()
                    Toast.makeText(context, "Export failed", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    LaunchedEffect(mapId) {
        viewModel.loadMap(mapId)
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete Map?") },
            text = { Text("Are you sure you want to delete this map? This action cannot be undone.") },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.deleteMap(mapId) {
                            OfflineManager.removeOfflineMap(context, mapId)
                            showDeleteConfirm = false
                            onBack()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showDownloadConfirm && downloadSummary != null) {
        AlertDialog(
            onDismissRequest = { showDownloadConfirm = false },
            title = { Text("Download Map for Offline?") },
            text = {
                Column {
                    Text("This will download high-detail tiles for the entire map area and surgical detail around each pin.")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Estimated Tiles: ${downloadSummary!!.tileCount}", fontWeight = FontWeight.Bold)
                    Text("Estimated Size: ${String.format("%.1f", downloadSummary!!.sizeMB)} MB", fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Existing cached tiles will be skipped automatically.", style = MaterialTheme.typography.bodySmall)
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showDownloadConfirm = false
                        val mv = mapViewRef
                        val state = uiState
                        if (mv != null && state is UiState.Success) {
                            val intent = Intent(context, MapDownloadService::class.java).apply {
                                putExtra("map_data", Gson().toJson(state.data))
                                val bboxData = mapOf(
                                    "n" to downloadSummary!!.bbox.latNorth,
                                    "e" to downloadSummary!!.bbox.lonEast,
                                    "s" to downloadSummary!!.bbox.latSouth,
                                    "w" to downloadSummary!!.bbox.lonWest
                                )
                                putExtra("bounding_box", Gson().toJson(bboxData))
                            }
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                context.startForegroundService(intent)
                            } else {
                                context.startService(intent)
                            }
                            DownloadProgressTracker.updateProgress(mapId, 0f)
                        }
                    }
                ) {
                    Text("Download")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDownloadConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            val title = (uiState as? UiState.Success)?.data?.name ?: "Loading..."
            CenterAlignedTopAppBar(
                title = { 
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Place, contentDescription = null, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(title, fontWeight = FontWeight.Bold)
                            if (isOfflineAvailable) {
                                Spacer(modifier = Modifier.width(8.dp))
                                Icon(
                                    Icons.Default.CloudDone, 
                                    contentDescription = "Available Offline",
                                    tint = SuccessGreen,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                        if (isDownloading) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                LinearProgressIndicator(
                                    progress = downloadProgress,
                                    modifier = Modifier.fillMaxWidth(0.6f).height(4.dp).padding(top = 4.dp),
                                    color = SuccessGreen,
                                    trackColor = Color.White.copy(alpha = 0.3f)
                                )
                                Text(
                                    text = "${(downloadProgress * 100).toInt()}% downloaded",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Color.White.copy(alpha = 0.8f),
                                    fontSize = 8.sp
                                )
                            }
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More options")
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { 
                                Text(if (isOfflineAvailable) "Update Offline Map" else "Download Map (Offline)") 
                            },
                            onClick = {
                                Log.i("MapDownload", "Download button clicked")
                                showMenu = false
                                val mv = mapViewRef
                                val state = uiState
                                if (mv != null && state is UiState.Success) {
                                    val markers = mv.overlays.filterIsInstance<Marker>()
                                    val boundingBox = if (markers.size > 1) {
                                        val points = markers.map { it.position }
                                        BoundingBox.fromGeoPoints(points)
                                    } else if (markers.size == 1) {
                                        val p = markers[0].position
                                        BoundingBox(p.latitude + 0.01, p.longitude + 0.01, p.latitude - 0.01, p.longitude - 0.01)
                                    } else {
                                        mv.boundingBox
                                    }
                                    
                                    // Calculate summary
                                    var totalTiles = TileCalculator.countTiles(boundingBox, 1, 10)
                                    state.data.pins.forEach { pin ->
                                        val box = BoundingBox(pin.lat + 0.005, pin.lng + 0.005, pin.lat - 0.005, pin.lng - 0.005)
                                        totalTiles += TileCalculator.countTiles(box, 11, 16)
                                    }
                                    
                                    downloadSummary = DownloadSummary(
                                        tileCount = totalTiles,
                                        sizeMB = TileCalculator.estimateSizeMB(totalTiles),
                                        bbox = boundingBox
                                    )
                                    showDownloadConfirm = true
                                } else {
                                    Log.e("MapDownload", "MapView or State is not ready")
                                }
                            },
                            leadingIcon = { 
                                Icon(
                                    if (isOfflineAvailable) Icons.Default.CloudSync else Icons.Default.Download, 
                                    contentDescription = null
                                ) 
                            }
                        )
                        if (isOfflineAvailable) {
                            DropdownMenuItem(
                                text = { Text("Delete Offline Cache") },
                                onClick = {
                                    showMenu = false
                                    OfflineManager.removeOfflineMap(context, mapId)
                                    isOfflineAvailable = false
                                    Toast.makeText(context, "Offline cache removed", Toast.LENGTH_SHORT).show()
                                },
                                leadingIcon = { 
                                    Icon(Icons.Default.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.error) 
                                }
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("Export KML") },
                            onClick = {
                                showMenu = false
                                val state = uiState
                                if (state is UiState.Success) {
                                    exportLauncher.launch("${state.data.name.replace(" ", "_")}.kml")
                                }
                            },
                            leadingIcon = { Icon(Icons.Default.Share, contentDescription = null) }
                        )
                        Divider()
                        DropdownMenuItem(
                            text = { Text("Delete Map", color = MaterialTheme.colorScheme.error) },
                            onClick = {
                                showMenu = false
                                showDeleteConfirm = true
                            },
                            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) }
                        )
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = DarkSlateBlue,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize().background(LightGray)) {
            when (val state = uiState) {
                is UiState.Loading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                is UiState.Error -> {
                    Text("Error: ${state.message}", modifier = Modifier.align(Alignment.Center), color = Color.Red)
                }
                is UiState.Success -> {
                    val mapData = state.data
                    
                    Column {
                        Box(modifier = Modifier.weight(1f)) {
                            AndroidView(
                                modifier = Modifier.fillMaxSize(),
                                factory = { ctx ->
                                    Log.i("MapDownload", "MapView factory called")
                                    MapView(ctx).apply {
                                        setTileSource(permissiveTileSource)
                                        setMultiTouchControls(true)
                                        zoomController.setVisibility(org.osmdroid.views.CustomZoomButtonsController.Visibility.NEVER)
                                        
                                        // Set map to use cache first (offline-friendly)
                                        setUseDataConnection(true)
                                        
                                        mapViewRef = this
                                        Log.i("MapDownload", "mapViewRef set")

                                        val eventsOverlay = MapEventsOverlay(object : MapEventsReceiver {
                                            override fun singleTapConfirmedHelper(p: GeoPoint?): Boolean {
                                                selectedPin = null
                                                overlays.forEach { if (it is Marker) it.closeInfoWindow() }
                                                return true
                                            }

                                            override fun longPressHelper(p: GeoPoint?): Boolean {
                                                p?.let {
                                                    val newPin = Pin(
                                                        id = java.util.UUID.randomUUID().toString(),
                                                        lat = it.latitude,
                                                        lng = it.longitude,
                                                        label = "New Pin",
                                                        description = "",
                                                        imageUrl = null,
                                                        color = "blue",
                                                        icon = "default",
                                                        groupId = null,
                                                        position = mapData.pins.size
                                                    )
                                                    val updatedPins = mapData.pins.toMutableList()
                                                    updatedPins.add(newPin)
                                                    viewModel.updateMap(mapData.copy(pins = updatedPins))
                                                }
                                                return true
                                            }
                                        })
                                        overlays.add(eventsOverlay)
                                    }
                                },
                                update = { mapView ->
                                    // Keep events overlay
                                    if (mapView.overlays.size > 1) {
                                        mapView.overlays.subList(1, mapView.overlays.size).forEach { 
                                            if (it is Marker) it.closeInfoWindow() 
                                        }
                                        mapView.overlays.subList(1, mapView.overlays.size).clear()
                                    }

                                    mapData.pins.forEach { pin ->
                                        val marker = Marker(mapView)
                                        marker.position = GeoPoint(pin.lat, pin.lng)
                                        marker.title = pin.label
                                        marker.snippet = pin.description
                                        marker.icon = MarkerUtils.getColoredMarker(context, pin.color, pin.icon)
                                        
                                        marker.setOnMarkerClickListener { m, _ ->
                                            selectedPin = pin
                                            m.showInfoWindow()
                                            true
                                        }
                                        mapView.overlays.add(marker)
                                    }
                                    
                                    mapView.invalidate()

                                    if (!hasAutoZoomed && mapData.pins.isNotEmpty()) {
                                        if (mapData.pins.size == 1) {
                                            val p = mapData.pins[0]
                                            mapView.controller.setCenter(GeoPoint(p.lat, p.lng))
                                            mapView.controller.setZoom(15.0)
                                            hasAutoZoomed = true
                                        } else {
                                            if (mapView.width > 0 && mapView.height > 0) {
                                                try {
                                                    val points = mapData.pins.map { GeoPoint(it.lat, it.lng) }
                                                    val boundingBox = BoundingBox.fromGeoPoints(points)
                                                    mapView.zoomToBoundingBox(boundingBox, true, 100)
                                                    hasAutoZoomed = true
                                                } catch (e: Exception) {
                                                    e.printStackTrace()
                                                }
                                            } else {
                                                mapView.addOnLayoutChangeListener(object : android.view.View.OnLayoutChangeListener {
                                                    override fun onLayoutChange(v: android.view.View, l: Int, t: Int, r: Int, b: Int, ol: Int, ot: Int, or: Int, ob: Int) {
                                                        mapView.removeOnLayoutChangeListener(this)
                                                        if (mapData.pins.size > 1) {
                                                            try {
                                                                val points = mapData.pins.map { GeoPoint(it.lat, it.lng) }
                                                                val boundingBox = BoundingBox.fromGeoPoints(points)
                                                                mapView.zoomToBoundingBox(boundingBox, true, 100)
                                                                hasAutoZoomed = true
                                                            } catch (e: Exception) {
                                                                e.printStackTrace()
                                                            }
                                                        }
                                                    }
                                                })
                                            }
                                        }
                                    } else if (!hasAutoZoomed && mapData.pins.isEmpty()) {
                                        mapView.controller.setZoom(2.0)
                                        mapView.controller.setCenter(GeoPoint(20.0, 0.0))
                                        hasAutoZoomed = true
                                    }
                                }
                            )
                        }
                        
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            color = Color.White,
                            shadowElevation = 16.dp,
                            shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
                        ) {
                            Column(modifier = Modifier.padding(24.dp)) {
                                if (selectedPin != null) {
                                    var editedLabel by remember(selectedPin?.id) { mutableStateOf(selectedPin?.label ?: "") }
                                    var editedDescription by remember(selectedPin?.id) { mutableStateOf(selectedPin?.description ?: "") }
                                    var editedColor by remember(selectedPin?.id) { mutableStateOf(selectedPin?.color ?: "blue") }
                                    var editedIcon by remember(selectedPin?.id) { mutableStateOf(selectedPin?.icon ?: "default") }

                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Edit Pin", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                        IconButton(onClick = {
                                            val updatedPins = mapData.pins.filter { it.id != selectedPin?.id }
                                            viewModel.updateMap(mapData.copy(pins = updatedPins))
                                            selectedPin = null
                                        }) {
                                            Icon(Icons.Default.Delete, contentDescription = "Delete Pin", tint = Color.Red)
                                        }
                                    }

                                    val updatePin = { newLabel: String, newDescription: String, newColor: String, newIcon: String ->
                                        val updatedPins = mapData.pins.map { 
                                            if (it.id == selectedPin?.id) it.copy(
                                                label = newLabel,
                                                description = newDescription,
                                                color = newColor,
                                                icon = newIcon
                                            ) else it 
                                        }
                                        viewModel.updateMap(mapData.copy(pins = updatedPins))
                                    }

                                    OutlinedTextField(
                                        value = editedLabel,
                                        onValueChange = { 
                                            editedLabel = it
                                            updatePin(it, editedDescription, editedColor, editedIcon)
                                        },
                                        label = { Text("Name") },
                                        modifier = Modifier.fillMaxWidth()
                                    )
                                    Spacer(modifier = Modifier.height(8.dp))
                                    OutlinedTextField(
                                        value = editedDescription,
                                        onValueChange = { 
                                            editedDescription = it
                                            updatePin(editedLabel, it, editedColor, editedIcon)
                                        },
                                        label = { Text("Description") },
                                        modifier = Modifier.fillMaxWidth(),
                                        minLines = 2
                                    )
                                    Spacer(modifier = Modifier.height(16.dp))
                                    
                                    Text("Color", style = MaterialTheme.typography.labelMedium)
                                    Row(
                                        modifier = Modifier.padding(vertical = 8.dp),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        val colorMap = mapOf(
                                            "blue" to Color(0xFF2A81CB),
                                            "red" to Color(0xFFCB2B3E),
                                            "green" to Color(0xFF2AAD27),
                                            "orange" to Color(0xFFCB8427),
                                            "violet" to Color(0xFF9C2BCB)
                                        )
                                        colorMap.forEach { (colorName, colorValue) ->
                                            Box(
                                                modifier = Modifier
                                                    .size(36.dp)
                                                    .background(colorValue, CircleShape)
                                                    .clickable { 
                                                        editedColor = colorName 
                                                        updatePin(editedLabel, editedDescription, colorName, editedIcon)
                                                    }
                                                    .padding(4.dp)
                                            ) {
                                                if (editedColor == colorName) {
                                                    Icon(Icons.Default.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp).align(Alignment.Center))
                                                }
                                            }
                                        }
                                        
                                        Spacer(modifier = Modifier.width(8.dp))
                                        
                                        var hexInput by remember(selectedPin?.id) { 
                                            mutableStateOf(if (editedColor.startsWith("#")) editedColor else "") 
                                        }
                                        
                                        OutlinedTextField(
                                            value = hexInput,
                                            onValueChange = { 
                                                if (it.length <= 7) {
                                                    hexInput = it
                                                    if (it.length == 7 && it.startsWith("#")) {
                                                        editedColor = it
                                                        updatePin(editedLabel, editedDescription, it, editedIcon)
                                                    } else if (it.length == 6 && !it.startsWith("#")) {
                                                        val fullHex = "#$it"
                                                        editedColor = fullHex
                                                        updatePin(editedLabel, editedDescription, fullHex, editedIcon)
                                                    }
                                                }
                                            },
                                            label = { Text("Hex") },
                                            modifier = Modifier.width(100.dp),
                                            textStyle = MaterialTheme.typography.bodySmall,
                                            placeholder = { Text("#RRGGBB") },
                                            singleLine = true
                                        )
                                    }

                                    Spacer(modifier = Modifier.height(8.dp))
                                    Text("Icon", style = MaterialTheme.typography.labelMedium)
                                    Column {
                                        Row(modifier = Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            listOf("default", "hotel", "restaurant", "airport").forEach { type ->
                                                FilterChip(
                                                    selected = editedIcon == type,
                                                    onClick = { 
                                                        editedIcon = type 
                                                        updatePin(editedLabel, editedDescription, editedColor, type)
                                                    },
                                                    label = { Text(type.replaceFirstChar { it.uppercase() }, fontSize = 10.sp) }
                                                )
                                            }
                                        }
                                        Row(modifier = Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            listOf("park", "museum", "shopping", "camera").forEach { type ->
                                                FilterChip(
                                                    selected = editedIcon == type,
                                                    onClick = { 
                                                        editedIcon = type 
                                                        updatePin(editedLabel, editedDescription, editedColor, type)
                                                    },
                                                    label = { Text(type.replaceFirstChar { it.uppercase() }, fontSize = 10.sp) }
                                                )
                                            }
                                        }
                                    }

                                    Spacer(modifier = Modifier.height(16.dp))
                                    Button(
                                        onClick = { selectedPin = null },
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(8.dp),
                                        colors = ButtonDefaults.buttonColors(containerColor = SuccessGreen)
                                    ) {
                                        Text("Done")
                                    }
                                } else {
                                    Column(modifier = Modifier.fillMaxWidth()) {
                                        Text(
                                            text = mapData.name,
                                            style = MaterialTheme.typography.headlineSmall,
                                            fontWeight = FontWeight.Bold,
                                            color = DarkSlateBlue
                                        )
                                        Text(
                                            text = "${mapData.pins.size} Pins",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = Color.Gray
                                        )
                                        Spacer(modifier = Modifier.height(16.dp))
                                        Text("Long press on map to add a pin. Tap marker to edit.", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
