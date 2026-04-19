package com.google.ourmaps.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.core.content.ContextCompat
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.ourmaps.model.Pin
import com.google.ourmaps.model.PinGroup
import com.google.ourmaps.ui.theme.DarkSlateBlue
import com.google.ourmaps.ui.theme.LightGray
import com.google.ourmaps.ui.theme.SuccessGreen
import com.google.ourmaps.utils.*
import com.google.ourmaps.utils.CollaboratorManager
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
import android.util.Log
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import org.osmdroid.views.overlay.mylocation.GpsMyLocationProvider
import org.osmdroid.views.overlay.mylocation.MyLocationNewOverlay

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

    // Layer / Group visibility
    var visibleGroupIds by remember { mutableStateOf<Set<String?>>(emptySet()) }
    var showLayersDialog by remember { mutableStateOf(false) }
    // Layer editing
    var editingGroupId by remember { mutableStateOf<String?>(null) }
    var editingGroupName by remember { mutableStateOf("") }

    // Search
    var isSearching by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<SearchResult>>(emptyList()) }
    var isGeocoding by remember { mutableStateOf(false) }

    // New layer creation
    var showCreateLayerDialog by remember { mutableStateOf(false) }
    var newLayerName by remember { mutableStateOf("") }
    var pendingPinForNewLayer by remember { mutableStateOf<Pin?>(null) }
    // Initialize visibility once data loads
    LaunchedEffect(uiState) {
        val state = uiState
        if (state is UiState.Success && visibleGroupIds.isEmpty()) {
            val allGroups = state.data.groups.map { it.id }.toSet() + (null as String?)
            visibleGroupIds = allGroups
        }
    }

    var selectedPin by remember { mutableStateOf<Pin?>(null) }
    var isEditingPin by remember { mutableStateOf(false) }
    var showLegend by remember { mutableStateOf(false) }

    BackHandler(enabled = selectedPin != null || isSearching) {
        if (isSearching) {
            isSearching = false
            searchQuery = ""
            searchResults = emptyList()
        } else {
            selectedPin = null
            isEditingPin = false
        }
    }
    var showMenu by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    
    // Download confirmation
    var showDownloadConfirm by remember { mutableStateOf(false) }
    var downloadSummary by remember { mutableStateOf<DownloadSummary?>(null) }

    // Share Map
    var showShareDialog by remember { mutableStateOf(false) }
    var shareEmail by remember { mutableStateOf("") }
    var shareRole by remember { mutableStateOf("view") }

    // Offline status
    var isOfflineAvailable by remember(mapId) { 
        mutableStateOf(OfflineManager.isMapDownloaded(context, mapId)) 
    }
    
    // Track if we've already auto-zoomed for the current map
    var hasAutoZoomed by remember(mapId) { mutableStateOf(false) }

    // Reference to MapView
    var mapViewRef by remember { mutableStateOf<MapView?>(null) }
    var locationOverlay by remember { mutableStateOf<MyLocationNewOverlay?>(null) }

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
                        val state = uiState
                        if (state is UiState.Success) {
                            val intent = Intent(context, MapDownloadService::class.java).apply {
                                putExtra("map_data", Gson().toJson(state.data))
                                val bbox = downloadSummary!!.bbox
                                val bboxData = mapOf("n" to bbox.latNorth, "e" to bbox.lonEast, "s" to bbox.latSouth, "w" to bbox.lonWest)
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

    if (showLayersDialog && uiState is UiState.Success) {
        val mapData = (uiState as UiState.Success).data
        AlertDialog(
            onDismissRequest = { 
                showLayersDialog = false
                editingGroupId = null
            },
            title = { Text("Map Layers") },
            text = {
                LazyColumn(modifier = Modifier.fillMaxWidth()) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable {
                            visibleGroupIds = if (visibleGroupIds.contains(null)) visibleGroupIds - null else visibleGroupIds + null
                        }.padding(vertical = 8.dp)) {
                            Checkbox(checked = visibleGroupIds.contains(null), onCheckedChange = {
                                visibleGroupIds = if (it) visibleGroupIds + null else visibleGroupIds - null
                            })
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Default (No Group)", modifier = Modifier.weight(1f))
                            
                            IconButton(onClick = {
                                val groupPins = mapData.pins.filter { it.groupId == null }
                                if (groupPins.size >= 2) {
                                    val origin = groupPins.first()
                                    val destination = groupPins.last()
                                    val waypoints = if (groupPins.size > 2) {
                                        groupPins.subList(1, groupPins.size - 1).joinToString("|") { "${it.lat},${it.lng}" }
                                    } else ""
                                    
                                    val uriString = "https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&waypoints=$waypoints&travelmode=driving&dir_action=navigate"
                                    val uri = Uri.parse(uriString)
                                    val intent = Intent(Intent.ACTION_VIEW, uri).apply { setPackage("com.google.android.apps.maps") }
                                    try { context.startActivity(intent) } catch (e: Exception) { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                                } else if (groupPins.size == 1) {
                                    val pin = groupPins[0]
                                    val uri = Uri.parse("google.navigation:q=${pin.lat},${pin.lng}")
                                    context.startActivity(Intent(Intent.ACTION_VIEW, uri).apply { setPackage("com.google.android.apps.maps") })
                                } else {
                                    Toast.makeText(context, "No pins in this layer", Toast.LENGTH_SHORT).show()
                                }
                            }) {
                                Icon(Icons.Default.Route, contentDescription = "Navigate Layer", modifier = Modifier.size(16.dp), tint = DarkSlateBlue)
                            }
                        }
                    }
                    items(mapData.groups) { group ->
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable {
                            visibleGroupIds = if (visibleGroupIds.contains(group.id)) visibleGroupIds - group.id else visibleGroupIds + group.id
                        }.padding(vertical = 8.dp)) {
                            Checkbox(checked = visibleGroupIds.contains(group.id), onCheckedChange = {
                                visibleGroupIds = if (it) visibleGroupIds + group.id else visibleGroupIds - group.id
                            })
                            Spacer(modifier = Modifier.width(8.dp))
                            
                            if (editingGroupId == group.id) {
                                OutlinedTextField(
                                    value = editingGroupName,
                                    onValueChange = { editingGroupName = it },
                                    modifier = Modifier.weight(1f),
                                    singleLine = true,
                                    trailingIcon = {
                                        IconButton(onClick = {
                                            val updatedGroups = mapData.groups.map { 
                                                if (it.id == group.id) it.copy(name = editingGroupName) else it 
                                            }
                                            viewModel.updateMap(mapData.copy(groups = updatedGroups))
                                            editingGroupId = null
                                        }) {
                                            Icon(Icons.Default.Check, contentDescription = "Save")
                                        }
                                    }
                                )
                            } else {
                                Text(group.name, modifier = Modifier.weight(1f))
                                
                                IconButton(onClick = {
                                    val groupPins = mapData.pins.filter { it.groupId == group.id }
                                    if (groupPins.size >= 2) {
                                        val origin = groupPins.first()
                                        val destination = groupPins.last()
                                        val waypoints = if (groupPins.size > 2) {
                                            groupPins.subList(1, groupPins.size - 1).joinToString("|") { "${it.lat},${it.lng}" }
                                        } else ""
                                        
                                        val uriString = "https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&waypoints=$waypoints&travelmode=driving&dir_action=navigate"
                                        val uri = Uri.parse(uriString)
                                        val intent = Intent(Intent.ACTION_VIEW, uri).apply { setPackage("com.google.android.apps.maps") }
                                        try { context.startActivity(intent) } catch (e: Exception) { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                                    } else if (groupPins.size == 1) {
                                        val pin = groupPins[0]
                                        val uri = Uri.parse("google.navigation:q=${pin.lat},${pin.lng}")
                                        context.startActivity(Intent(Intent.ACTION_VIEW, uri).apply { setPackage("com.google.android.apps.maps") })
                                    } else {
                                        Toast.makeText(context, "No pins in this layer", Toast.LENGTH_SHORT).show()
                                    }
                                }) {
                                    Icon(Icons.Default.Route, contentDescription = "Navigate Layer", modifier = Modifier.size(16.dp), tint = DarkSlateBlue)
                                }

                                IconButton(onClick = {
                                    editingGroupId = group.id
                                    editingGroupName = group.name
                                }) {
                                    Icon(Icons.Default.Edit, contentDescription = "Rename", modifier = Modifier.size(16.dp))
                                }
                                IconButton(onClick = {
                                    // Move pins in this group back to default
                                    val updatedPins = mapData.pins.map { 
                                        if (it.groupId == group.id) it.copy(groupId = null) else it 
                                    }
                                    val updatedGroups = mapData.groups.filter { it.id != group.id }
                                    visibleGroupIds = visibleGroupIds - group.id
                                    viewModel.updateMap(mapData.copy(groups = updatedGroups, pins = updatedPins))
                                }) {
                                    Icon(Icons.Default.Delete, contentDescription = "Delete Layer", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { 
                    showLayersDialog = false
                    editingGroupId = null
                }) {
                    Text("Done")
                }
            }
        )
    }

    if (showCreateLayerDialog && uiState is UiState.Success) {
        val mapData = (uiState as UiState.Success).data
        AlertDialog(
            onDismissRequest = { showCreateLayerDialog = false },
            title = { Text("Create New Layer") },
            text = {
                OutlinedTextField(
                    value = newLayerName,
                    onValueChange = { newLayerName = it },
                    label = { Text("Layer Name") },
                    singleLine = true
                )
            },
            confirmButton = {
                Button(onClick = {
                    if (newLayerName.isNotBlank()) {
                        val nid = java.util.UUID.randomUUID().toString()
                        visibleGroupIds = visibleGroupIds + nid
                        val newGroups = mapData.groups + com.google.ourmaps.model.PinGroup(nid, newLayerName, mapData.groups.size)
                        
                        // If we started this from a pin, move that pin to the new group
                        val updatedPins = if (pendingPinForNewLayer != null) {
                            mapData.pins.map { 
                                if (it.id == pendingPinForNewLayer?.id) it.copy(groupId = nid) else it 
                            }
                        } else {
                            mapData.pins
                        }
                        
                        viewModel.updateMap(mapData.copy(groups = newGroups, pins = updatedPins))
                        showCreateLayerDialog = false
                        newLayerName = ""
                        pendingPinForNewLayer = null
                    }
                }) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateLayerDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showShareDialog) {
        val mapData = (uiState as? UiState.Success)?.data
        AlertDialog(
            onDismissRequest = { showShareDialog = false },
            title = { Text("Manage Map Access") },
            text = {
                Column(modifier = Modifier.fillMaxWidth()) {
                    if (mapData?.userRole == "owner") {
                        Text("Add New User", style = MaterialTheme.typography.titleSmall)
                        Spacer(modifier = Modifier.height(8.dp))
                        
                        // Email Auto-complete
                        var showEmailSuggestions by remember { mutableStateOf(false) }
                        val allEmails = remember { CollaboratorManager.getEmails(context).toList() }
                        val filteredEmails = remember(shareEmail) {
                            if (shareEmail.length < 2) emptyList()
                            else allEmails.filter { it.contains(shareEmail, ignoreCase = true) }
                        }

                        Box(modifier = Modifier.fillMaxWidth()) {
                            OutlinedTextField(
                                value = shareEmail,
                                onValueChange = { 
                                    shareEmail = it
                                    showEmailSuggestions = true
                                },
                                label = { Text("User Email") },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                trailingIcon = {
                                    if (shareEmail.isNotEmpty()) {
                                        IconButton(onClick = { shareEmail = "" }) {
                                            Icon(Icons.Default.Clear, contentDescription = "Clear")
                                        }
                                    }
                                }
                            )
                            
                            DropdownMenu(
                                expanded = showEmailSuggestions && filteredEmails.isNotEmpty(),
                                onDismissRequest = { showEmailSuggestions = false },
                                properties = androidx.compose.ui.window.PopupProperties(focusable = false)
                            ) {
                                filteredEmails.forEach { email ->
                                    DropdownMenuItem(
                                        text = { Text(email) },
                                        onClick = {
                                            shareEmail = email
                                            showEmailSuggestions = false
                                        }
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Permission Level", style = MaterialTheme.typography.labelMedium)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = shareRole == "view", onClick = { shareRole = "view" })
                            Text("Viewer")
                            Spacer(modifier = Modifier.width(16.dp))
                            RadioButton(selected = shareRole == "edit", onClick = { shareRole = "edit" })
                            Text("Editor")
                        }
                        
                        Button(
                            onClick = {
                                if (shareEmail.isNotBlank()) {
                                    viewModel.shareMap(shareEmail, shareRole) {
                                        CollaboratorManager.addEmail(context, shareEmail)
                                        shareEmail = ""
                                        showShareDialog = false
                                        Toast.makeText(context, "Map shared successfully", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                        ) {
                            Text("Invite User")
                        }
                        
                        Divider(modifier = Modifier.padding(vertical = 16.dp))
                    }

                    Text("Who Has Access", style = MaterialTheme.typography.titleSmall)
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    val accessList = mapData?.access ?: emptyList()
                    if (accessList.isEmpty()) {
                        Text("Only you have access", style = MaterialTheme.typography.bodyMedium, color = Color.Gray)
                    } else {
                        LazyColumn(modifier = Modifier.heightIn(max = 200.dp)) {
                            items(accessList) { mapUser ->
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(mapUser.name ?: mapUser.email, style = MaterialTheme.typography.bodyMedium)
                                        Text(mapUser.role.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                                    }
                                    if (mapData?.userRole == "owner" && mapUser.role != "owner") {
                                        IconButton(onClick = {
                                            viewModel.removeShare(mapUser.id) {
                                                Toast.makeText(context, "Permission removed", Toast.LENGTH_SHORT).show()
                                            }
                                        }) {
                                            Icon(Icons.Default.Close, contentDescription = "Remove", tint = Color.Red, modifier = Modifier.size(20.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showShareDialog = false }) {
                    Text("Close")
                }
            }
        )
    }

    if (showLegend && uiState is UiState.Success) {
        val mapData = (uiState as UiState.Success).data
        ModalBottomSheet(
            onDismissRequest = { showLegend = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ) {
            LegendContent(
                mapData = mapData,
                visibleGroupIds = visibleGroupIds,
                onPinClick = { pin ->
                    selectedPin = pin
                    isEditingPin = false
                    showLegend = false
                    mapViewRef?.controller?.animateTo(GeoPoint(pin.lat, pin.lng))
                    mapViewRef?.controller?.setZoom(17.0)
                }
            )
        }
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
                                Icon(Icons.Default.CloudDone, contentDescription = "Available Offline", tint = SuccessGreen, modifier = Modifier.size(16.dp))
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
                                Text(text = "${(downloadProgress * 100).toInt()}% downloaded", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.8f), fontSize = 8.sp)
                            }
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = { showLayersDialog = true }) { Icon(Icons.Default.Layers, contentDescription = "Layers") }
                    IconButton(onClick = { showMenu = true }) { Icon(Icons.Default.MoreVert, contentDescription = "More options") }
                    DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                        DropdownMenuItem(
                            text = { Text(if (isOfflineAvailable) "Update Offline Map" else "Download Map (Offline)") },
                            onClick = {
                                showMenu = false
                                val mv = mapViewRef
                                val state = uiState
                                if (mv != null && state is UiState.Success) {
                                    val markers = mv.overlays.filterIsInstance<Marker>()
                                    val rawBbox = if (markers.size > 1) {
                                        BoundingBox.fromGeoPoints(markers.map { it.position })
                                    } else if (markers.size == 1) {
                                        val p = markers[0].position
                                        BoundingBox(p.latitude + 0.01, p.longitude + 0.01, p.latitude - 0.01, p.longitude - 0.01)
                                    } else {
                                        mv.boundingBox
                                    }
                                    val minSpan = 0.01
                                    val boundingBox = if (rawBbox.latitudeSpan < minSpan || rawBbox.longitudeSpan < minSpan) {
                                        BoundingBox(
                                            rawBbox.centerWithDateLine.latitude + (maxOf(minSpan, rawBbox.latitudeSpan) / 2.0),
                                            rawBbox.centerWithDateLine.longitude + (maxOf(minSpan, rawBbox.longitudeSpan) / 2.0),
                                            rawBbox.centerWithDateLine.latitude - (maxOf(minSpan, rawBbox.latitudeSpan) / 2.0),
                                            rawBbox.centerWithDateLine.longitude - (maxOf(minSpan, rawBbox.longitudeSpan) / 2.0)
                                        )
                                    } else rawBbox
                                    
                                    var totalTiles = TileCalculator.countTiles(boundingBox, 1, 10)
                                    state.data.pins.forEach { pin ->
                                        totalTiles += TileCalculator.countTiles(BoundingBox(pin.lat + 0.005, pin.lng + 0.005, pin.lat - 0.005, pin.lng - 0.005), 11, 16)
                                    }
                                    downloadSummary = DownloadSummary(totalTiles, TileCalculator.estimateSizeMB(totalTiles), boundingBox)
                                    showDownloadConfirm = true
                                }
                            },
                            leadingIcon = { Icon(if (isOfflineAvailable) Icons.Default.CloudSync else Icons.Default.Download, contentDescription = null) }
                        )
                        if (isOfflineAvailable) {
                            DropdownMenuItem(
                                text = { Text("Delete Offline Cache") },
                                onClick = {
                                    showMenu = false
                                    OfflineManager.removeOfflineMap(context, mapId)
                                    isOfflineAvailable = false
                                },
                                leadingIcon = { Icon(Icons.Default.CloudOff, contentDescription = null, tint = MaterialTheme.colorScheme.error) }
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("Export KML") },
                            onClick = {
                                showMenu = false
                                (uiState as? UiState.Success)?.let { exportLauncher.launch("${it.data.name.replace(" ", "_")}.kml") }
                            },
                            leadingIcon = { Icon(Icons.Default.Share, contentDescription = null) }
                        )
                        DropdownMenuItem(
                            text = { Text("Invite Others") },
                            onClick = {
                                showMenu = false
                                showShareDialog = true
                            },
                            leadingIcon = { Icon(Icons.Default.PersonAdd, contentDescription = null) }
                        )
                        Divider()
                        DropdownMenuItem(
                            text = { Text("Delete Map", color = MaterialTheme.colorScheme.error) },
                            onClick = { showMenu = false; showDeleteConfirm = true },
                            leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) }
                        )
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = DarkSlateBlue, titleContentColor = Color.White, navigationIconContentColor = Color.White, actionIconContentColor = Color.White)
            )
        },
        floatingActionButton = {
            Column(horizontalAlignment = Alignment.End) {
                if (uiState is UiState.Success) {
                    FloatingActionButton(
                        onClick = {
                            locationOverlay?.let { overlay ->
                                if (overlay.myLocation != null) {
                                    mapViewRef?.controller?.animateTo(overlay.myLocation)
                                    mapViewRef?.controller?.setZoom(17.0)
                                } else {
                                    Toast.makeText(context, "Location not available", Toast.LENGTH_SHORT).show()
                                }
                            }
                        },
                        containerColor = Color.White,
                        contentColor = DarkSlateBlue,
                        modifier = Modifier.padding(bottom = 16.dp).size(48.dp)
                    ) {
                        Icon(Icons.Default.MyLocation, contentDescription = "My Location")
                    }
                }

                if (!isSearching && selectedPin == null && uiState is UiState.Success) {
                    FloatingActionButton(
                        onClick = { isSearching = true },
                        containerColor = DarkSlateBlue,
                        contentColor = Color.White
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "Add Pin")
                    }
                }
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize().background(LightGray)) {
            when (val state = uiState) {
                is UiState.Loading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                is UiState.Error -> Text("Error: ${state.message}", modifier = Modifier.align(Alignment.Center), color = Color.Red)
                is UiState.Success -> {
                    val mapData = state.data
                    Column {
                        Box(modifier = Modifier.weight(1f)) {
                            AndroidView(
                                modifier = Modifier.fillMaxSize(),
                                factory = { ctx ->
                                    MapView(ctx).apply {
                                        setTileSource(permissiveTileSource)
                                        setMultiTouchControls(true)
                                        zoomController.setVisibility(org.osmdroid.views.CustomZoomButtonsController.Visibility.NEVER)
                                        setUseDataConnection(true)
                                        mapViewRef = this
                                        
                                        val locOverlay = MyLocationNewOverlay(GpsMyLocationProvider(ctx), this)
                                        locOverlay.enableMyLocation()
                                        
                                        // Set custom blue dot icon
                                        ContextCompat.getDrawable(ctx, com.google.ourmaps.R.drawable.blue_dot)?.let { drawable ->
                                            val bitmap = MarkerUtils.drawableToBitmap(drawable)
                                            locOverlay.setPersonIcon(bitmap)
                                            locOverlay.setDirectionIcon(bitmap)
                                        }
                                        
                                        locationOverlay = locOverlay
                                        overlays.add(locOverlay)

                                        val eventsOverlay = MapEventsOverlay(object : MapEventsReceiver {
                                            override fun singleTapConfirmedHelper(p: GeoPoint?): Boolean {
                                                selectedPin = null
                                                overlays.forEach { if (it is Marker) it.closeInfoWindow() }
                                                return true
                                            }
                                            override fun longPressHelper(p: GeoPoint?): Boolean {
                                                p?.let {
                                                    val newPin = Pin(java.util.UUID.randomUUID().toString(), it.latitude, it.longitude, "New Pin", "", null, "blue", "default", null, mapData.pins.size)
                                                    viewModel.updateMap(mapData.copy(pins = mapData.pins + newPin))
                                                }
                                                return true
                                            }
                                        })
                                        overlays.add(eventsOverlay)
                                    }
                                },
                                update = { mv ->
                                    // Remove all markers but keep location and event overlays
                                    val markersToRemove = mv.overlays.filterIsInstance<Marker>()
                                    markersToRemove.forEach { it.closeInfoWindow() }
                                    mv.overlays.removeAll(markersToRemove)
                                    
                                    mapData.pins.filter { it.groupId in visibleGroupIds }.forEach { pin ->
                                        val marker = Marker(mv).apply {
                                            position = GeoPoint(pin.lat, pin.lng)
                                            title = pin.label
                                            snippet = pin.description
                                            icon = MarkerUtils.getColoredMarker(context, pin.color ?: "blue", pin.icon ?: "default")
                                            setOnMarkerClickListener { m, _ ->
                                                selectedPin = pin
                                                isEditingPin = false
                                                m.showInfoWindow()
                                                true
                                            }
                                        }
                                        mv.overlays.add(marker)
                                    }
                                    mv.invalidate()
                                    if (!hasAutoZoomed && mapData.pins.isNotEmpty()) {
                                        if (mapData.pins.size == 1) {
                                            mv.controller.setCenter(GeoPoint(mapData.pins[0].lat, mapData.pins[0].lng))
                                            mv.controller.setZoom(15.0)
                                            hasAutoZoomed = true
                                        } else {
                                            if (mv.width > 0 && mv.height > 0) {
                                                try {
                                                    mv.zoomToBoundingBox(BoundingBox.fromGeoPoints(mapData.pins.map { GeoPoint(it.lat, it.lng) }), true, 100)
                                                    hasAutoZoomed = true
                                                } catch (e: Exception) { }
                                            } else {
                                                mv.addOnLayoutChangeListener(object : android.view.View.OnLayoutChangeListener {
                                                    override fun onLayoutChange(v: android.view.View, l: Int, t: Int, r: Int, b: Int, ol: Int, ot: Int, or: Int, ob: Int) {
                                                        mv.removeOnLayoutChangeListener(this)
                                                        try { mv.zoomToBoundingBox(BoundingBox.fromGeoPoints(mapData.pins.map { GeoPoint(it.lat, it.lng) }), true, 100); hasAutoZoomed = true } catch (e: Exception) {}
                                                    }
                                                })
                                            }
                                        }
                                    } else if (!hasAutoZoomed && mapData.pins.isEmpty()) {
                                        mv.controller.setZoom(2.0); mv.controller.setCenter(GeoPoint(20.0, 0.0)); hasAutoZoomed = true
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
                            Column(
                                modifier = Modifier
                                    .padding(horizontal = 24.dp, vertical = 8.dp)
                                    .pointerInput(Unit) {
                                        var totalDrag = 0f
                                        detectVerticalDragGestures(
                                            onDragEnd = {
                                                if (totalDrag < -50f) {
                                                    showLegend = true
                                                }
                                                totalDrag = 0f
                                            },
                                            onVerticalDrag = { change, dragAmount ->
                                                change.consume()
                                                totalDrag += dragAmount
                                            }
                                        )
                                    }
                            ) {
                                // Swipe handle
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.CenterHorizontally)
                                        .width(40.dp)
                                        .height(4.dp)
                                        .background(Color.LightGray, RoundedCornerShape(2.dp))
                                )
                                Spacer(modifier = Modifier.height(16.dp))

                                if (selectedPin != null) {
                                    val pin = mapData.pins.find { it.id == selectedPin?.id } ?: selectedPin!!
                                    
                                    if (!isEditingPin) {
                                        // View Mode
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text(pin.label ?: "Unnamed Pin", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                            IconButton(onClick = { selectedPin = null }) { Icon(Icons.Default.Close, contentDescription = "Close") }
                                        }
                                        
                                        if (!pin.description.isNullOrBlank()) {
                                            Text(pin.description!!, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(vertical = 8.dp))
                                        }
                                        
                                        val groupName = mapData.groups.find { it.id == pin.groupId }?.name ?: "Default Layer"
                                        AssistChip(
                                            onClick = { },
                                            label = { Text(groupName) },
                                            leadingIcon = { Icon(Icons.Default.Layers, contentDescription = null, modifier = Modifier.size(16.dp)) }
                                        )
                                        
                                        Spacer(modifier = Modifier.height(16.dp))
                                        
                                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Button(
                                                onClick = {
                                                    val gmmUri = Uri.parse("google.navigation:q=${pin.lat},${pin.lng}")
                                                    val mapIntent = Intent(Intent.ACTION_VIEW, gmmUri).apply { setPackage("com.google.android.apps.maps") }
                                                    try { context.startActivity(mapIntent) } catch (e: Exception) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:${pin.lat},${pin.lng}?q=${pin.lat},${pin.lng}"))) }
                                                },
                                                modifier = Modifier.weight(1f),
                                                colors = ButtonDefaults.buttonColors(containerColor = DarkSlateBlue)
                                            ) {
                                                Icon(Icons.Default.Directions, contentDescription = null)
                                                Spacer(modifier = Modifier.width(8.dp))
                                                Text("Directions")
                                            }
                                            
                                            if (mapData.userRole == "owner" || mapData.userRole == "edit") {
                                                OutlinedButton(
                                                    onClick = { isEditingPin = true },
                                                    modifier = Modifier.weight(1f)
                                                ) {
                                                    Icon(Icons.Default.Edit, contentDescription = null)
                                                    Spacer(modifier = Modifier.width(8.dp))
                                                    Text("Edit")
                                                }
                                            }
                                        }
                                    } else {
                                        // Edit Mode
                                        var editedLabel by remember(pin.id) { mutableStateOf(pin.label ?: "") }
                                        var editedDescription by remember(pin.id) { mutableStateOf(pin.description ?: "") }
                                        var editedColor by remember(pin.id) { mutableStateOf(pin.color ?: "blue") }
                                        var editedIcon by remember(pin.id) { mutableStateOf(pin.icon ?: "default") }
                                        val updatePin = { l: String, d: String, c: String, i: String, g: String? ->
                                            viewModel.updateMap(mapData.copy(pins = mapData.pins.map { if (it.id == pin.id) it.copy(label = l, description = d, color = c, icon = i, groupId = g) else it }))
                                        }
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text("Edit Pin", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                            IconButton(onClick = { 
                                                viewModel.updateMap(mapData.copy(pins = mapData.pins.filter { it.id != pin.id }))
                                                selectedPin = null 
                                            }) { Icon(Icons.Default.Delete, contentDescription = "Delete", tint = Color.Red) }
                                        }
                                        OutlinedTextField(value = editedLabel, onValueChange = { editedLabel = it; updatePin(it, editedDescription, editedColor, editedIcon, pin.groupId) }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
                                        Spacer(modifier = Modifier.height(8.dp))
                                        OutlinedTextField(value = editedDescription, onValueChange = { editedDescription = it; updatePin(editedLabel, it, editedColor, editedIcon, pin.groupId) }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                                        Spacer(modifier = Modifier.height(8.dp))
                                        var showGroupDropdown by remember { mutableStateOf(false) }
                                        val currentGroupName = remember(pin.id, pin.groupId, mapData.groups) {
                                            mapData.groups.find { it.id == pin.groupId }?.name ?: "No Group (Default)"
                                        }
                                        
                                        Box(modifier = Modifier.fillMaxWidth().clickable { showGroupDropdown = true }) {
                                            OutlinedTextField(
                                                value = currentGroupName,
                                                onValueChange = { },
                                                readOnly = true,
                                                label = { Text("Layer") },
                                                modifier = Modifier.fillMaxWidth(),
                                                enabled = false,
                                                colors = OutlinedTextFieldDefaults.colors(
                                                    disabledTextColor = MaterialTheme.colorScheme.onSurface,
                                                    disabledBorderColor = MaterialTheme.colorScheme.outline,
                                                    disabledLabelColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    disabledTrailingIconColor = MaterialTheme.colorScheme.onSurfaceVariant
                                                ),
                                                trailingIcon = { Icon(Icons.Default.ArrowDropDown, contentDescription = null) }
                                            )
                                            DropdownMenu(expanded = showGroupDropdown, onDismissRequest = { showGroupDropdown = false }) {
                                                DropdownMenuItem(text = { Text("No Group (Default)") }, onClick = { updatePin(editedLabel, editedDescription, editedColor, editedIcon, null); showGroupDropdown = false })
                                                mapData.groups.forEach { g -> DropdownMenuItem(text = { Text(g.name) }, onClick = { updatePin(editedLabel, editedDescription, editedColor, editedIcon, g.id); showGroupDropdown = false }) }
                                                Divider()
                                                DropdownMenuItem(
                                                    text = { Text("Create New Layer...") },
                                                    onClick = {
                                                        showGroupDropdown = false
                                                        pendingPinForNewLayer = pin
                                                        newLayerName = ""
                                                        showCreateLayerDialog = true
                                                    },
                                                    leadingIcon = { Icon(Icons.Default.Add, contentDescription = null) }
                                                )
                                            }
                                        }
                                        Spacer(modifier = Modifier.height(16.dp))
                                        Text("Color", style = MaterialTheme.typography.labelMedium)
                                        Row(modifier = Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            val colors = mapOf("blue" to Color(0xFF2A81CB), "red" to Color(0xFFCB2B3E), "green" to Color(0xFF2AAD27), "orange" to Color(0xFFCB8427), "violet" to Color(0xFF9C2BCB))
                                            colors.forEach { (n, v) -> Box(modifier = Modifier.size(36.dp).background(v, CircleShape).clickable { editedColor = n; updatePin(editedLabel, editedDescription, n, editedIcon, pin.groupId) }.padding(4.dp)) { if (editedColor == n) Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.size(20.dp).align(Alignment.Center)) } }
                                        }
                                        Spacer(modifier = Modifier.height(8.dp))
                                        Text("Icon", style = MaterialTheme.typography.labelMedium)
                                        Column {
                                            listOf(listOf("default", "hotel", "restaurant", "airport"), listOf("park", "museum", "shopping", "camera")).forEach { row ->
                                                Row(modifier = Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                    row.forEach { t -> FilterChip(selected = editedIcon == t, onClick = { editedIcon = t; updatePin(editedLabel, editedDescription, editedColor, t, pin.groupId) }, label = { Text(t.replaceFirstChar { it.uppercase() }, fontSize = 10.sp) }) }
                                                }
                                            }
                                        }
                                        Spacer(modifier = Modifier.height(16.dp))
                                        Button(onClick = { isEditingPin = false }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = SuccessGreen)) { Text("Done Editing") }
                                    }
                                } else {
                                    Text(text = mapData.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = DarkSlateBlue)
                                    Text(text = "${mapData.pins.size} Pins", style = MaterialTheme.typography.bodyMedium, color = Color.Gray)
                                    Spacer(modifier = Modifier.height(16.dp))
                                    Text("Long press on map to add a pin. Tap marker to edit.", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                                }
                            }
                        }
                    }

                    if (isSearching) {
                        Surface(
                            modifier = Modifier.fillMaxSize(),
                            color = MaterialTheme.colorScheme.background
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconButton(onClick = { isSearching = false; searchQuery = ""; searchResults = emptyList() }) {
                                        Icon(Icons.Default.ArrowBack, contentDescription = "Close Search")
                                    }
                                    OutlinedTextField(
                                        value = searchQuery,
                                        onValueChange = { searchQuery = it },
                                        placeholder = { Text("Search for a place...") },
                                        modifier = Modifier.weight(1f),
                                        singleLine = true,
                                        trailingIcon = {
                                            if (searchQuery.isNotEmpty()) {
                                                if (isGeocoding) {
                                                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                                } else {
                                                    IconButton(onClick = { searchQuery = "" }) {
                                                        Icon(Icons.Default.Clear, contentDescription = "Clear")
                                                    }
                                                }
                                            }
                                        }
                                    )
                                }
                                
                                LaunchedEffect(searchQuery) {
                                    if (searchQuery.length > 2) {
                                        isGeocoding = true
                                        searchResults = GeocodingService.search(context, searchQuery, mapViewRef?.boundingBox)
                                        isGeocoding = false
                                    } else {
                                        searchResults = emptyList()
                                    }
                                }

                                Spacer(modifier = Modifier.height(16.dp))
                                
                                LazyColumn {
                                    items(searchResults) { result ->
                                        ListItem(
                                            headlineContent = { Text(result.name) },
                                            supportingContent = { Text(result.description) },
                                            leadingContent = { Icon(Icons.Default.Place, contentDescription = null) },
                                            modifier = Modifier.clickable {
                                                val newPin = Pin(
                                                    id = java.util.UUID.randomUUID().toString(),
                                                    lat = result.location.latitude,
                                                    lng = result.location.longitude,
                                                    label = result.name,
                                                    description = result.description,
                                                    imageUrl = null,
                                                    color = "blue",
                                                    icon = "default",
                                                    groupId = null,
                                                    position = mapData.pins.size
                                                )
                                                viewModel.updateMap(mapData.copy(pins = mapData.pins + newPin))
                                                
                                                mapViewRef?.controller?.animateTo(result.location)
                                                mapViewRef?.controller?.setZoom(16.0)
                                                
                                                isSearching = false
                                                searchQuery = ""
                                                searchResults = emptyList()
                                                selectedPin = newPin
                                            }
                                        )
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

@Composable
fun LegendContent(
    mapData: com.google.ourmaps.model.MapData,
    visibleGroupIds: Set<String?>,
    onPinClick: (Pin) -> Unit
) {
    var expandedGroupIds by remember { mutableStateOf<Set<String?>>(visibleGroupIds) }

    Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        Text("Map Legend", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(16.dp))
        
        LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 500.dp)) {
            // Default Group
            item {
                LegendGroupHeader(
                    name = "Default Layer",
                    isExpanded = expandedGroupIds.contains(null),
                    onToggle = { 
                        expandedGroupIds = if (expandedGroupIds.contains(null)) expandedGroupIds - null else expandedGroupIds + null
                    }
                )
            }
            
            val defaultPins = mapData.pins.filter { it.groupId == null }
            if (defaultPins.isEmpty() && expandedGroupIds.contains(null)) {
                item { Text("No pins in this layer", modifier = Modifier.padding(start = 32.dp, bottom = 8.dp), style = MaterialTheme.typography.bodySmall, color = Color.Gray) }
            } else if (expandedGroupIds.contains(null)) {
                items(defaultPins) { pin ->
                    LegendPinItem(pin = pin, onClick = { onPinClick(pin) })
                }
            }
            
            // Other Groups
            mapData.groups.forEach { group ->
                item {
                    LegendGroupHeader(
                        name = group.name,
                        isExpanded = expandedGroupIds.contains(group.id),
                        onToggle = { 
                            expandedGroupIds = if (expandedGroupIds.contains(group.id)) expandedGroupIds - group.id else expandedGroupIds + group.id
                        }
                    )
                }
                
                val groupPins = mapData.pins.filter { it.groupId == group.id }
                if (groupPins.isEmpty() && expandedGroupIds.contains(group.id)) {
                    item { Text("No pins in this layer", modifier = Modifier.padding(start = 32.dp, bottom = 8.dp), style = MaterialTheme.typography.bodySmall, color = Color.Gray) }
                } else if (expandedGroupIds.contains(group.id)) {
                    items(groupPins) { pin ->
                        LegendPinItem(pin = pin, onClick = { onPinClick(pin) })
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
fun LegendGroupHeader(name: String, isExpanded: Boolean, onToggle: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically, 
        modifier = Modifier.fillMaxWidth().clickable { onToggle() }.padding(vertical = 8.dp)
    ) {
        Icon(Icons.Default.Layers, contentDescription = null, modifier = Modifier.size(20.dp), tint = DarkSlateBlue)
        Spacer(modifier = Modifier.width(12.dp))
        Text(name, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Icon(if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, contentDescription = null)
    }
}

@Composable
fun LegendPinItem(pin: Pin, onClick: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(start = 32.dp, top = 4.dp, bottom = 4.dp, end = 16.dp)) {
        Icon(Icons.Default.Place, contentDescription = null, modifier = Modifier.size(16.dp), tint = Color(when(pin.color) {
            "red" -> 0xFFCB2B3E
            "green" -> 0xFF2AAD27
            "orange" -> 0xFFCB8427
            "violet" -> 0xFF9C2BCB
            else -> 0xFF2A81CB
        }))
        Spacer(modifier = Modifier.width(8.dp))
        Text(pin.label ?: "Unnamed Pin", style = MaterialTheme.typography.bodyMedium)
    }
}
