package com.google.ourmaps.ui

import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.google.gson.Gson
import com.google.ourmaps.model.Pin
import com.google.ourmaps.model.PinGroup
import com.google.ourmaps.services.MapDownloadService
import com.google.ourmaps.ui.theme.DarkSlateBlue
import com.google.ourmaps.ui.theme.LightGray
import com.google.ourmaps.ui.theme.SuccessGreen
import com.google.ourmaps.utils.*
import com.google.ourmaps.viewmodel.MapDetailViewModel
import com.google.ourmaps.viewmodel.UiState
import kotlinx.coroutines.launch
import org.osmdroid.events.MapEventsReceiver
import org.osmdroid.tileprovider.tilesource.TileSourcePolicy
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.mylocation.GpsMyLocationProvider
import org.osmdroid.views.overlay.mylocation.MyLocationNewOverlay
import java.io.OutputStream

data class DownloadSummary(val tileCount: Int, val sizeMB: Double, val bbox: BoundingBox)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapDetailScreen(
    mapId: String,
    viewModel: MapDetailViewModel,
    onBack: () -> Unit
) {
    Log.d("OURMAPS_DEBUG", "Entering MapDetailScreen for mapId: $mapId")
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    
    // Custom TileSource that allows bulk downloading
    val permissiveTileSource = remember {
        Log.d("OURMAPS_DEBUG", "Creating permissiveTileSource")
        XYTileSource(
            "OpenStreetMap",
            0, 19, 256, ".png", 
            arrayOf("https://a.tile.openstreetmap.org/", "https://b.tile.openstreetmap.org/", "https://c.tile.openstreetmap.org/"),
            "© OpenStreetMap contributors",
            TileSourcePolicy(2, TileSourcePolicy.FLAG_USER_AGENT_MEANINGFUL or TileSourcePolicy.FLAG_USER_AGENT_NORMALIZED)
        )
    }

    // Background download status
    val activeDownloads by DownloadProgressTracker.activeDownloads.collectAsState()
    val progressMap by DownloadProgressTracker.downloadProgress.collectAsState()
    val isDownloading = activeDownloads.contains(mapId)
    val downloadProgress = progressMap[mapId] ?: 0f

    // Layer / Group visibility (Sticky via SharedPreferences)
    val prefs = remember { context.getSharedPreferences("map_prefs_$mapId", android.content.Context.MODE_PRIVATE) }
    
    var visibleGroupIds by remember { 
        val saved = prefs.getStringSet("visible_layers", null)
        mutableStateOf(saved?.map { it as String? }?.toSet() ?: emptySet<String?>())
    }

    var expandedGroupIds by remember { 
        val saved = prefs.getStringSet("expanded_layers", null)
        mutableStateOf(saved?.map { it as String? }?.toSet() ?: emptySet<String?>())
    }

    // Initialize visibility once data loads if prefs are empty
    LaunchedEffect(uiState) {
        val state = uiState
        Log.d("OURMAPS_DEBUG", "LaunchedEffect(uiState): state changed to ${state.javaClass.simpleName}")
        if (state is UiState.Success && visibleGroupIds.isEmpty() && !prefs.contains("visible_layers")) {
            Log.d("OURMAPS_DEBUG", "Initializing default visibility from Success state")
            val allGroups = state.data.groups.map { it.id }.toSet() + (null as String?)
            visibleGroupIds = allGroups
            prefs.edit().putStringSet("visible_layers", allGroups.filterNotNull().toSet()).apply()
        }
    }

    val onToggleGroupVisibility: (String?) -> Unit = { id ->
        Log.d("OURMAPS_DEBUG", "toggleGroupVisibility($id)")
        visibleGroupIds = if (visibleGroupIds.contains(id)) visibleGroupIds - id else visibleGroupIds + id
        prefs.edit().putStringSet("visible_layers", visibleGroupIds.filterNotNull().toSet()).apply()
    }

    val onToggleExpand: (String?) -> Unit = { id ->
        Log.d("OURMAPS_DEBUG", "toggleExpand($id)")
        expandedGroupIds = if (expandedGroupIds.contains(id)) expandedGroupIds - id else expandedGroupIds + id
        prefs.edit().putStringSet("expanded_layers", expandedGroupIds.filterNotNull().toSet()).apply()
    }

    // Search
    var isSearching by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<SearchResult>>(emptyList()) }
    var isGeocoding by remember { mutableStateOf(false) }

    // New layer creation
    var showCreateLayerDialog by remember { mutableStateOf(false) }
    var newLayerName by remember { mutableStateOf("") }
    var pendingPinForNewLayer by remember { mutableStateOf<Pin?>(null) }
    
    var selectedPin by remember { mutableStateOf<Pin?>(null) }
    var isEditingPin by remember { mutableStateOf(false) }
    
    val scaffoldState = rememberBottomSheetScaffoldState()
    val density = LocalDensity.current
    var peekHeightPx by remember { mutableIntStateOf(0) }
    val sheetPeekHeight = remember(peekHeightPx) { with(density) { (peekHeightPx).toDp() + 48.dp } }

    BackHandler(enabled = selectedPin != null || isSearching || scaffoldState.bottomSheetState.currentValue == SheetValue.Expanded) {
        Log.d("OURMAPS_DEBUG", "BackHandler triggered")
        if (scaffoldState.bottomSheetState.currentValue == SheetValue.Expanded) {
            coroutineScope.launch { scaffoldState.bottomSheetState.partialExpand() }
        } else if (isSearching) {
            isSearching = false; searchQuery = ""; searchResults = emptyList()
        } else {
            selectedPin = null; isEditingPin = false
        }
    }
    
    var showMenu by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var showDownloadConfirm by remember { mutableStateOf(false) }
    var downloadSummary by remember { mutableStateOf<DownloadSummary?>(null) }
    var showShareDialog by remember { mutableStateOf(false) }
    var shareEmail by remember { mutableStateOf("") }
    var shareRole by remember { mutableStateOf("view") }

    var isOfflineAvailable by remember(mapId) { mutableStateOf(OfflineManager.isMapDownloaded(context, mapId)) }
    LaunchedEffect(downloadProgress) {
        if (downloadProgress >= 1.0f) {
            Log.d("OURMAPS_DEBUG", "Download reached 1.0, updating isOfflineAvailable")
            isOfflineAvailable = OfflineManager.isMapDownloaded(context, mapId)
        }
    }
    
    var hasAutoZoomed by rememberSaveable(mapId) { mutableStateOf(false) }
    var mapViewRef by remember { mutableStateOf<MapView?>(null) }
    var locationOverlay by remember { mutableStateOf<MyLocationNewOverlay?>(null) }

    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/vnd.google-earth.kml+xml")) { uri ->
        uri?.let {
            if (uiState is UiState.Success) {
                try {
                    Log.d("OURMAPS_DEBUG", "Exporting KML to $uri")
                    context.contentResolver.openOutputStream(it)?.use { stream ->
                        stream.write(KmlHelper.generateKmlFromMapData((uiState as UiState.Success).data).toByteArray())
                    }
                    Toast.makeText(context, "Map exported successfully", Toast.LENGTH_SHORT).show()
                } catch (e: Exception) { 
                    Log.e("OURMAPS_DEBUG", "Export failed", e)
                    Toast.makeText(context, "Export failed", Toast.LENGTH_SHORT).show() 
                }
            }
        }
    }

    LaunchedEffect(mapId) { 
        Log.d("OURMAPS_DEBUG", "LaunchedEffect(mapId): loading $mapId")
        viewModel.loadMap(mapId) 
    }

    // Centering and highlighting selected pin
    LaunchedEffect(selectedPin) {
        val pin = selectedPin
        if (pin != null) {
            Log.d("OURMAPS_DEBUG", "LaunchedEffect(selectedPin): centering on ${pin.id}")
            // Small delay to allow potential marker re-renders/layout changes to settle
            kotlinx.coroutines.delay(100)
            mapViewRef?.let { mv ->
                mv.controller.animateTo(GeoPoint(pin.lat, pin.lng))
                val marker = mv.overlays.filterIsInstance<Marker>().find { it.id == pin.id }
                if (marker != null) {
                    marker.showInfoWindow()
                } else {
                    Log.w("OURMAPS_DEBUG", "Marker not found for pin ${pin.id}")
                }
            }
        }
    }

    // Auto-zoom when data first arrives
    LaunchedEffect(uiState) {
        val state = uiState
        if (state is UiState.Success && !hasAutoZoomed && state.data.pins.isNotEmpty()) {
            Log.d("OURMAPS_DEBUG", "LaunchedEffect(uiState): Triggering auto-zoom")
            mapViewRef?.let { mv ->
                try {
                    mv.zoomToBoundingBox(BoundingBox.fromGeoPoints(state.data.pins.map { GeoPoint(it.lat, it.lng) }), true, 100)
                    hasAutoZoomed = true
                } catch (e: Exception) {
                    Log.e("OURMAPS_DEBUG", "Auto-zoom failed", e)
                }
            }
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(onDismissRequest = { showDeleteConfirm = false }, title = { Text("Delete Map?") }, text = { Text("Are you sure?") },
            confirmButton = { Button(onClick = { 
                Log.d("OURMAPS_DEBUG", "Deleting map $mapId")
                viewModel.deleteMap(mapId) { OfflineManager.removeOfflineMap(context, mapId); showDeleteConfirm = false; onBack() } 
            }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text("Cancel") } }
        )
    }

    if (showDownloadConfirm && downloadSummary != null) {
        AlertDialog(onDismissRequest = { showDownloadConfirm = false }, title = { Text("Download Map?") }, text = {
            Column {
                Text("This will download map tiles for the current area and high-detail tiles around each of your pins.")
                Spacer(modifier = Modifier.height(8.dp))
                Text("Estimated Tiles: ${downloadSummary!!.tileCount}", fontWeight = FontWeight.Bold)
                Text("Estimated Size: ${String.format("%.1f", downloadSummary!!.sizeMB)} MB", fontWeight = FontWeight.Bold)
            }
        }, confirmButton = { Button(onClick = {
                showDownloadConfirm = false
                val state = uiState
                if (state is UiState.Success) {
                    Log.d("OURMAPS_DEBUG", "Starting MapDownloadService for ${state.data.id}")
                    val intent = Intent(context, MapDownloadService::class.java).apply {
                        putExtra("map_data", Gson().toJson(state.data))
                        val bbox = downloadSummary!!.bbox
                        putExtra("bounding_box", Gson().toJson(mapOf("n" to bbox.latNorth, "e" to bbox.lonEast, "s" to bbox.latSouth, "w" to bbox.lonWest)))
                    }
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
                    DownloadProgressTracker.updateProgress(mapId, 0f)
                }
            }) { Text("Download") } },
            dismissButton = { TextButton(onClick = { showDownloadConfirm = false }) { Text("Cancel") } }
        )
    }

    if (showCreateLayerDialog && uiState is UiState.Success) {
        val mapData = (uiState as UiState.Success).data
        AlertDialog(onDismissRequest = { showCreateLayerDialog = false }, title = { Text("New Layer") }, text = { OutlinedTextField(value = newLayerName, onValueChange = { newLayerName = it }, label = { Text("Name") }) },
            confirmButton = { Button(onClick = {
                if (newLayerName.isNotBlank()) {
                    Log.d("OURMAPS_DEBUG", "Creating new layer: $newLayerName")
                    val nid = java.util.UUID.randomUUID().toString()
                    onToggleGroupVisibility(nid)
                    val updatedPins = if (pendingPinForNewLayer != null) mapData.pins.map { if (it.id == pendingPinForNewLayer?.id) it.copy(groupId = nid) else it } else mapData.pins
                    viewModel.updateMap(mapData.copy(groups = mapData.groups + PinGroup(nid, newLayerName, mapData.groups.size), pins = updatedPins))
                    showCreateLayerDialog = false; newLayerName = ""; pendingPinForNewLayer = null
                }
            }) { Text("Create") } }
        )
    }

    if (showShareDialog) {
        val mapData = (uiState as? UiState.Success)?.data
        AlertDialog(onDismissRequest = { showShareDialog = false }, title = { Text("Map Access") }, text = {
            Column {
                if (mapData?.userRole == "owner") {
                    OutlinedTextField(value = shareEmail, onValueChange = { shareEmail = it }, label = { Text("Email") })
                    Button(onClick = { if (shareEmail.isNotBlank()) { 
                        Log.d("OURMAPS_DEBUG", "Sharing map with $shareEmail")
                        viewModel.shareMap(shareEmail, shareRole) { showShareDialog = false; shareEmail = "" } 
                    } }) { Text("Invite") }
                }
                mapData?.permissions?.forEach { p -> Text("${p.userEmail}: ${p.role}") }
            }
        }, confirmButton = { TextButton(onClick = { showShareDialog = false }) { Text("Close") } })
    }

    BottomSheetScaffold(
        scaffoldState = scaffoldState,
        sheetPeekHeight = sheetPeekHeight,
        sheetContainerColor = Color.White,
        sheetShape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        sheetDragHandle = { Box(modifier = Modifier.padding(vertical = 12.dp).width(40.dp).height(4.dp).background(Color.LightGray, RoundedCornerShape(2.dp))) },
        sheetContent = {
            if (uiState is UiState.Success) {
                val mapData = (uiState as UiState.Success).data
                Column(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 16.dp).onGloballyPositioned { 
                        Log.d("OURMAPS_DEBUG", "onGloballyPositioned: peekHeightPx update to ${it.size.height}")
                        peekHeightPx = it.size.height 
                    }) {
                        if (selectedPin != null) {
                            val pin = mapData.pins.find { it.id == selectedPin?.id } ?: selectedPin!!
                            if (!isEditingPin) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(pin.label ?: "Unnamed Pin", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                    IconButton(onClick = { selectedPin = null }) { Icon(Icons.Default.Close, contentDescription = "Close") }
                                }
                                if (!pin.address.isNullOrBlank()) Text(pin.address!!, style = MaterialTheme.typography.bodyMedium, color = Color.Gray)
                                if (!pin.description.isNullOrBlank()) Text(pin.description!!, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(vertical = 8.dp))
                                AssistChip(onClick = { }, label = { Text(mapData.groups.find { it.id == pin.groupId }?.name ?: "Default Layer") }, leadingIcon = { Icon(Icons.Default.Layers, null, modifier = Modifier.size(16.dp)) })
                                Row(modifier = Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(onClick = { 
                                        val uri = Uri.parse("google.navigation:q=${pin.lat},${pin.lng}")
                                        val intent = Intent(Intent.ACTION_VIEW, uri).apply { setPackage("com.google.android.apps.maps") }
                                        try { context.startActivity(intent) } catch (e: Exception) { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                                    }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = DarkSlateBlue)) { Icon(Icons.Default.Directions, null); Spacer(Modifier.width(8.dp)); Text("Directions") }
                                    if (mapData.userRole != "view") OutlinedButton(onClick = { isEditingPin = true }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.Edit, null); Spacer(Modifier.width(8.dp)); Text("Edit") }
                                }
                            } else {
                                var editedLabel by remember(pin.id) { mutableStateOf(pin.label ?: "") }
                                var editedAddress by remember(pin.id) { mutableStateOf(pin.address ?: "") }
                                var editedDescription by remember(pin.id) { mutableStateOf(pin.description ?: "") }
                                var editedColor by remember(pin.id) { mutableStateOf(pin.color ?: "blue") }
                                var editedIcon by remember(pin.id) { mutableStateOf(pin.icon ?: "default") }
                                val updatePinFn = { l: String, a: String, d: String, c: String, i: String, g: String? ->
                                    viewModel.updateMap(mapData.copy(pins = mapData.pins.map { if (it.id == pin.id) it.copy(label = l, address = a, description = d, color = c, icon = i, groupId = g) else it }))
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Edit Pin", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                    IconButton(onClick = { viewModel.updateMap(mapData.copy(pins = mapData.pins.filter { it.id != pin.id })); selectedPin = null }) { Icon(Icons.Default.Delete, null, tint = Color.Red) }
                                }
                                OutlinedTextField(value = editedLabel, onValueChange = { editedLabel = it; updatePinFn(it, editedAddress, editedDescription, editedColor, editedIcon, pin.groupId) }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
                                Spacer(modifier = Modifier.height(8.dp))
                                OutlinedTextField(value = editedAddress, onValueChange = { editedAddress = it; updatePinFn(editedLabel, it, editedDescription, editedColor, editedIcon, pin.groupId) }, label = { Text("Address") }, modifier = Modifier.fillMaxWidth())
                                Spacer(modifier = Modifier.height(8.dp))
                                OutlinedTextField(value = editedDescription, onValueChange = { editedDescription = it; updatePinFn(editedLabel, editedAddress, it, editedColor, editedIcon, pin.groupId) }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                                Spacer(modifier = Modifier.height(8.dp))
                                
                                var showGroupDropdown by remember { mutableStateOf(false) }
                                Box(modifier = Modifier.fillMaxWidth().clickable { showGroupDropdown = true }) {
                                    OutlinedTextField(value = mapData.groups.find { it.id == pin.groupId }?.name ?: "Default Layer", onValueChange = { }, readOnly = true, label = { Text("Layer") }, modifier = Modifier.fillMaxWidth(), enabled = false, trailingIcon = { Icon(Icons.Default.ArrowDropDown, null) }, colors = OutlinedTextFieldDefaults.colors(disabledTextColor = MaterialTheme.colorScheme.onSurface, disabledBorderColor = MaterialTheme.colorScheme.outline, disabledLabelColor = MaterialTheme.colorScheme.onSurfaceVariant, disabledTrailingIconColor = MaterialTheme.colorScheme.onSurfaceVariant))
                                    DropdownMenu(expanded = showGroupDropdown, onDismissRequest = { showGroupDropdown = false }) {
                                        DropdownMenuItem(text = { Text("Default Layer") }, onClick = { updatePinFn(editedLabel, editedAddress, editedDescription, editedColor, editedIcon, null); showGroupDropdown = false })
                                        mapData.groups.forEach { g -> DropdownMenuItem(text = { Text(g.name) }, onClick = { updatePinFn(editedLabel, editedAddress, editedDescription, editedColor, editedIcon, g.id); showGroupDropdown = false }) }
                                    }
                                }

                                Spacer(modifier = Modifier.height(16.dp))
                                Text("Color", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Row(modifier = Modifier.padding(vertical = 8.dp).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    val colors = mapOf("blue" to Color(0xFF2A81CB), "red" to Color(0xFFCB2B3E), "green" to Color(0xFF2AAD27), "orange" to Color(0xFFCB8427), "violet" to Color(0xFF9C2BCB), "gold" to Color(0xFFFFD700), "pink" to Color(0xFFFF69B4), "teal" to Color(0xFF008080), "brown" to Color(0xFF8B4513))
                                    colors.forEach { (n, v) -> 
                                        Box(modifier = Modifier.size(38.dp).background(v, CircleShape).clickable { 
                                            editedColor = n
                                            updatePinFn(editedLabel, editedAddress, editedDescription, n, editedIcon, pin.groupId) 
                                        }.padding(4.dp)) { 
                                            if (editedColor == n) Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.size(22.dp).align(Alignment.Center)) 
                                        } 
                                    }

                                    // Custom Hex Color Selector
                                    var showHexDialog by remember { mutableStateOf(false) }
                                    Box(modifier = Modifier.size(38.dp).background(Color.LightGray, CircleShape).clickable { showHexDialog = true }.padding(4.dp)) {
                                        val isCustom = editedColor.startsWith("#")
                                        if (isCustom) {
                                            val cColor = try { Color(android.graphics.Color.parseColor(editedColor)) } catch(e: Exception) { Color.Gray }
                                            Box(modifier = Modifier.fillMaxSize().background(cColor, CircleShape)) {
                                                Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.size(22.dp).align(Alignment.Center))
                                            }
                                        } else {
                                            Icon(Icons.Default.Palette, null, tint = Color.DarkGray, modifier = Modifier.size(22.dp).align(Alignment.Center))
                                        }
                                    }

                                    if (showHexDialog) {
                                        var hexValue by remember { mutableStateOf(if (editedColor.startsWith("#")) editedColor else "#2A81CB") }
                                        val extendedColors = listOf(
                                            "#F44336", "#E91E63", "#9C27B0", "#673AB7", "#3F51B5", "#2196F3", "#03A9F4", "#00BCD4",
                                            "#009688", "#4CAF50", "#8BC34A", "#CDDC39", "#FFEB3B", "#FFC107", "#FF9800", "#FF5722",
                                            "#795548", "#9E9E9E", "#607D8B", "#000000"
                                        )
                                        AlertDialog(
                                            onDismissRequest = { showHexDialog = false },
                                            title = { Text("Pick Color") },
                                            text = { 
                                                Column {
                                                    // Grid of colors
                                                    extendedColors.chunked(5).forEach { row ->
                                                        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                                                            row.forEach { c ->
                                                                Box(modifier = Modifier.size(40.dp).background(Color(android.graphics.Color.parseColor(c)), RoundedCornerShape(4.dp)).clickable {
                                                                    hexValue = c
                                                                }) {
                                                                    if (hexValue.uppercase() == c) Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.align(Alignment.Center))
                                                                }
                                                            }
                                                        }
                                                    }
                                                    Spacer(modifier = Modifier.height(16.dp))
                                                    Text("Or enter Hex Code:")
                                                    OutlinedTextField(value = hexValue, onValueChange = { hexValue = it }, placeholder = { Text("#RRGGBB") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                                }
                                            },
                                            confirmButton = { 
                                                Button(onClick = { 
                                                    if (hexValue.matches(Regex("^#[0-9A-Fa-f]{6}$"))) {
                                                        editedColor = hexValue
                                                        updatePinFn(editedLabel, editedAddress, editedDescription, hexValue, editedIcon, pin.groupId)
                                                        showHexDialog = false
                                                    } else {
                                                        Toast.makeText(context, "Invalid hex code", Toast.LENGTH_SHORT).show()
                                                    }
                                                }) { Text("Apply") } 
                                            },
                                            dismissButton = { TextButton(onClick = { showHexDialog = false }) { Text("Cancel") } }
                                        )
                                    }
                                }

                                Spacer(modifier = Modifier.height(8.dp))
                                Text("Icon", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                val iconOptions = listOf(Triple("default", Icons.Default.Place, "Default"), Triple("hotel", Icons.Default.Bed, "Hotel"), Triple("restaurant", Icons.Default.Restaurant, "Food"), Triple("airport", Icons.Default.LocalAirport, "Travel"), Triple("park", Icons.Default.Forest, "Park"), Triple("museum", Icons.Default.Museum, "Arts"), Triple("shopping", Icons.Default.ShoppingBag, "Shop"), Triple("camera", Icons.Default.PhotoCamera, "Photo"), Triple("gas", Icons.Default.LocalGasStation, "Gas"), Triple("charging", Icons.Default.Bolt, "EV"))
                                iconOptions.chunked(5).forEach { row ->
                                    Row(modifier = Modifier.padding(vertical = 4.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        row.forEach { (t, icon, label) -> FilterChip(selected = editedIcon == t, onClick = { editedIcon = t; updatePinFn(editedLabel, editedAddress, editedDescription, editedColor, t, pin.groupId) }, label = { Icon(icon, null, modifier = Modifier.size(20.dp)) }, colors = FilterChipDefaults.filterChipColors(selectedContainerColor = DarkSlateBlue, selectedLabelColor = Color.White)) }
                                    }
                                }
                                Spacer(modifier = Modifier.height(16.dp))
                                Button(onClick = { isEditingPin = false }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = SuccessGreen)) { Text("Done Editing") }
                            }
                        } else {
                            Text(text = mapData.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = DarkSlateBlue)
                            Text(text = "${mapData.pins.size} Pins", style = MaterialTheme.typography.bodyMedium, color = Color.Gray)
                        }
                    }
                    Divider(modifier = Modifier.padding(vertical = 16.dp))
                    LegendContent(mapData, visibleGroupIds, onToggleGroupVisibility, { id, n -> viewModel.updateMap(mapData.copy(groups = mapData.groups.map { if (it.id == id) it.copy(name = n) else it })) }, { id -> viewModel.updateMap(mapData.copy(groups = mapData.groups.filter { it.id != id }, pins = mapData.pins.map { if (it.groupId == id) it.copy(groupId = null) else it })) }, { pin -> 
                        selectedPin = pin; 
                        isEditingPin = false; 
                        coroutineScope.launch { 
                            scaffoldState.bottomSheetState.partialExpand()
                        }
                    }, viewModel, mapData.userRole, expandedGroupIds, onToggleExpand)
                }
            } else Box(modifier = Modifier.fillMaxWidth().height(100.dp))
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize().background(LightGray)) {
            val mapName = (uiState as? UiState.Success)?.data?.name ?: "Loading..."
            Column {
                CenterAlignedTopAppBar(
                    title = { 
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Place, null, modifier = Modifier.size(20.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(mapName, fontWeight = FontWeight.Bold)
                                if (isOfflineAvailable) { Spacer(modifier = Modifier.width(8.dp)); Icon(Icons.Default.CloudDone, null, tint = SuccessGreen, modifier = Modifier.size(16.dp)) }
                            }
                            if (isDownloading) LinearProgressIndicator(progress = downloadProgress, modifier = Modifier.fillMaxWidth(0.6f).height(4.dp).padding(top = 4.dp), color = SuccessGreen, trackColor = Color.White.copy(alpha = 0.3f))
                        }
                    },
                    navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, null) } },
                    actions = {
                        IconButton(onClick = { showMenu = true }) { Icon(Icons.Default.MoreVert, null) }
                        DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                            DropdownMenuItem(text = { Text(if (isOfflineAvailable) "Update Offline Map" else "Download Offline") }, onClick = {
                                showMenu = false
                                val mv = mapViewRef
                                val state = uiState
                                if (mv != null && state is UiState.Success) {
                                    val bbox = mv.boundingBox
                                    val total = TileCalculator.countTiles(bbox, 1, 12)
                                    downloadSummary = DownloadSummary(total, TileCalculator.estimateSizeMB(total), bbox)
                                    showDownloadConfirm = true
                                }
                            }, leadingIcon = { Icon(if (isOfflineAvailable) Icons.Default.CloudSync else Icons.Default.Download, null) })
                            DropdownMenuItem(text = { Text("Invite Others") }, onClick = { showMenu = false; showShareDialog = true }, leadingIcon = { Icon(Icons.Default.PersonAdd, null) })
                            DropdownMenuItem(text = { Text("Export KML") }, onClick = { showMenu = false; (uiState as? UiState.Success)?.let { exportLauncher.launch("${it.data.name}.kml") } }, leadingIcon = { Icon(Icons.Default.Share, null) })
                            Divider()
                            DropdownMenuItem(text = { Text("Delete Map", color = Color.Red) }, onClick = { showMenu = false; showDeleteConfirm = true }, leadingIcon = { Icon(Icons.Default.Delete, null, tint = Color.Red) })
                        }
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = DarkSlateBlue, titleContentColor = Color.White, navigationIconContentColor = Color.White, actionIconContentColor = Color.White)
                )

                Box(modifier = Modifier.weight(1f).clip(RectangleShape)) {
                    if (uiState is UiState.Success) {
                        val mapData = (uiState as UiState.Success).data
                        AndroidView(modifier = Modifier.fillMaxSize().clip(RectangleShape), factory = { ctx ->
                            Log.d("OURMAPS_DEBUG", "AndroidView: Factory creating MapView")
                            MapView(ctx).apply { 
                                setTileSource(permissiveTileSource)
                                setMultiTouchControls(true)
                                zoomController.setVisibility(org.osmdroid.views.CustomZoomButtonsController.Visibility.NEVER)
                                isTilesScaledToDpi = false
                                minZoomLevel = 2.0
                                maxZoomLevel = 20.0
                                mapViewRef = this
                                val locOverlay = MyLocationNewOverlay(GpsMyLocationProvider(ctx), this).apply { enableMyLocation() }
                                locationOverlay = locOverlay
                                overlays.add(locOverlay)
                                overlays.add(MapEventsOverlay(object : MapEventsReceiver {
                                    override fun singleTapConfirmedHelper(p: GeoPoint?): Boolean { selectedPin = null; return true }
                                    override fun longPressHelper(p: GeoPoint?): Boolean { 
                                        p?.let { 
                                            val newPin = Pin(id = java.util.UUID.randomUUID().toString(), lat = it.latitude, lng = it.longitude, label = "New Pin", position = mapData.pins.size)
                                            viewModel.updateMap(mapData.copy(pins = mapData.pins + newPin))
                                            viewModel.geocodePin(newPin.id) 
                                        }; return true 
                                    }
                                })) 
                            }
                        }, update = { mv ->
                            Log.d("OURMAPS_DEBUG", "AndroidView: Update called")
                            mv.overlays.filterIsInstance<Marker>().forEach { it.closeInfoWindow() }
                            mv.overlays.removeAll(mv.overlays.filterIsInstance<Marker>())
                            mapData.pins.filter { it.groupId in visibleGroupIds }.forEach { pin ->
                                mv.overlays.add(Marker(mv).apply { 
                                    id = pin.id // Set unique ID for robust lookup
                                    position = GeoPoint(pin.lat, pin.lng)
                                    setTitle(pin.label ?: "Unnamed")
                                    icon = MarkerUtils.getColoredMarker(context, pin.color ?: "blue", pin.icon ?: "default")
                                    setOnMarkerClickListener { m, _ -> selectedPin = pin; isEditingPin = false; m.showInfoWindow(); true } 
                                })
                            }
                        })
                        if (isOfflineAvailable) Surface(modifier = Modifier.align(Alignment.TopStart).padding(12.dp), color = Color.White.copy(alpha = 0.9f), shape = RoundedCornerShape(16.dp), border = androidx.compose.foundation.BorderStroke(1.dp, SuccessGreen.copy(alpha = 0.5f)), shadowElevation = 2.dp) { Row(modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.CloudDone, null, tint = SuccessGreen, modifier = Modifier.size(14.dp)); Spacer(modifier = Modifier.width(4.dp)); Text("Offline Ready", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = DarkSlateBlue) } }
                    } else if (uiState is UiState.Loading) CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                    Column(modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp), horizontalAlignment = Alignment.End) {
                        if (uiState is UiState.Success) {
                            FloatingActionButton(onClick = { locationOverlay?.let { if (it.myLocation != null) { mapViewRef?.controller?.animateTo(it.myLocation); mapViewRef?.controller?.setZoom(17.0) } } }, containerColor = Color.White, contentColor = DarkSlateBlue, modifier = Modifier.padding(bottom = 16.dp).size(48.dp)) { Icon(Icons.Default.MyLocation, null) }
                            FloatingActionButton(onClick = { isSearching = true }, containerColor = DarkSlateBlue, contentColor = Color.White) { Icon(Icons.Default.Add, null) }
                        }
                    }
                }
            }
            if (isSearching) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val mapData = (uiState as? UiState.Success)?.data
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) { 
                            IconButton(onClick = { isSearching = false; searchQuery = ""; searchResults = emptyList() }) { Icon(Icons.Default.ArrowBack, null) }
                            OutlinedTextField(value = searchQuery, onValueChange = { searchQuery = it }, placeholder = { Text("Search...") }, modifier = Modifier.weight(1f), singleLine = true) 
                        }
                        LaunchedEffect(searchQuery) { 
                            if (searchQuery.length > 2) { 
                                isGeocoding = true; searchResults = GeocodingService.search(context, searchQuery, mapViewRef?.boundingBox); isGeocoding = false 
                            } else searchResults = emptyList() 
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                        LazyColumn {
                            items(searchResults) { result ->
                                ListItem(headlineContent = { Text(result.name) }, supportingContent = { Text(result.description) }, leadingContent = { Icon(Icons.Default.Place, null) }, modifier = Modifier.clickable { 
                                    if (mapData != null) { 
                                        val newPin = Pin(id = java.util.UUID.randomUUID().toString(), lat = result.location.latitude, lng = result.location.longitude, label = result.name, description = "", address = result.description, position = mapData.pins.size)
                                        viewModel.updateMap(mapData.copy(pins = mapData.pins + newPin))
                                        viewModel.geocodePin(newPin.id)
                                        isSearching = false; searchQuery = ""; searchResults = emptyList(); selectedPin = newPin 
                                    } 
                                })
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
    onToggleGroupVisibility: (String?) -> Unit, 
    onUpdateGroup: (String, String) -> Unit, 
    onRemoveGroup: (String) -> Unit, 
    onPinClick: (Pin) -> Unit, 
    viewModel: MapDetailViewModel, 
    userRole: String?, 
    expandedGroupIds: Set<String?>, 
    onToggleExpand: (String?) -> Unit
) {
    var selectedNavPinIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var showNavigationDialog by remember { mutableStateOf(false) }
    var pinsToNavigate by remember { mutableStateOf<List<Pin>>(emptyList()) }
    val context = LocalContext.current
    
    if (showNavigationDialog) {
        AlertDialog(onDismissRequest = { showNavigationDialog = false }, title = { Text("Navigation Origin") }, text = { Text("Would you like to start navigation from your current location?") },
            confirmButton = { TextButton(onClick = { showNavigationDialog = false; val uriString = com.google.ourmaps.utils.NavigationUtils.generateNavigationUri(pinsToNavigate, true); context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uriString)).apply { setPackage("com.google.android.apps.maps") }); pinsToNavigate = emptyList() }) { Text("Current Location") } },
            dismissButton = { TextButton(onClick = { showNavigationDialog = false; val uriString = com.google.ourmaps.utils.NavigationUtils.generateNavigationUri(pinsToNavigate, false); context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uriString)).apply { setPackage("com.google.android.apps.maps") }); pinsToNavigate = emptyList() }) { Text("First Pin") } }
        )
    }
    
    Column(modifier = Modifier.padding(bottom = 32.dp)) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Map Legend", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DarkSlateBlue)
            if (selectedNavPinIds.isNotEmpty()) {
                Button(onClick = { 
                    pinsToNavigate = mapData.pins.filter { it.id in selectedNavPinIds }.sortedBy { it.position }
                    showNavigationDialog = true 
                }, colors = ButtonDefaults.buttonColors(containerColor = SuccessGreen), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp), modifier = Modifier.height(32.dp)) { 
                    Icon(Icons.Default.Directions, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("Go (${selectedNavPinIds.size})", fontSize = 12.sp) 
                }
            }
        }
        
        LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 600.dp)) {
            item {
                val pins = mapData.pins.filter { it.groupId == null }
                LegendGroupHeader(id = null, name = "Default Layer", isExpanded = expandedGroupIds.contains(null), isVisible = visibleGroupIds.contains(null), onToggle = { onToggleExpand(null) }, onToggleVisibility = { onToggleGroupVisibility(null) }, onNavigate = { if (pins.isNotEmpty()) { pinsToNavigate = pins; showNavigationDialog = true } else Toast.makeText(context, "No pins in this layer", Toast.LENGTH_SHORT).show() }, showSelectAll = pins.isNotEmpty() && expandedGroupIds.contains(null), isAllSelected = pins.isNotEmpty() && pins.all { it.id in selectedNavPinIds }, onSelectAll = { s -> val ids = pins.map { it.id }.toSet(); selectedNavPinIds = if (s) selectedNavPinIds + ids else selectedNavPinIds - ids }, userRole = userRole)
            }
            if (expandedGroupIds.contains(null)) {
                items(mapData.pins.filter { it.groupId == null }) { pin ->
                    LegendPinItem(pin, { onPinClick(pin) }, pin.id in selectedNavPinIds, { s -> selectedNavPinIds = if (s) selectedNavPinIds + pin.id else selectedNavPinIds - pin.id }, { val idx = mapData.pins.indexOfFirst { it.id == pin.id }; if (idx > 0) viewModel.movePin(idx, idx - 1) }, { val idx = mapData.pins.indexOfFirst { it.id == pin.id }; if (idx < mapData.pins.size - 1) viewModel.movePin(idx, idx + 1) }, userRole)
                }
            }
            mapData.groups.forEach { group ->
                val pins = mapData.pins.filter { it.groupId == group.id }
                item { LegendGroupHeader(group.id, group.name, expandedGroupIds.contains(group.id), visibleGroupIds.contains(group.id), onToggle = { onToggleExpand(group.id) }, onToggleVisibility = { onToggleGroupVisibility(group.id) }, onUpdateName = { onUpdateGroup(group.id, it) }, onDelete = { onRemoveGroup(group.id) }, onNavigate = { if (pins.isNotEmpty()) { pinsToNavigate = pins; showNavigationDialog = true } else Toast.makeText(context, "No pins in this layer", Toast.LENGTH_SHORT).show() }, showSelectAll = pins.isNotEmpty() && expandedGroupIds.contains(group.id), isAllSelected = pins.isNotEmpty() && pins.all { it.id in selectedNavPinIds }, onSelectAll = { s -> val ids = pins.map { it.id }.toSet(); selectedNavPinIds = if (s) selectedNavPinIds + ids else selectedNavPinIds - ids }, onMoveUp = { val idx = mapData.groups.indexOfFirst { it.id == group.id }; if (idx > 0) viewModel.moveGroup(idx, idx - 1) }, onMoveDown = { val idx = mapData.groups.indexOfFirst { it.id == group.id }; if (idx < mapData.groups.size - 1) viewModel.moveGroup(idx, idx + 1) }, userRole = userRole) }
                if (expandedGroupIds.contains(group.id)) {
                    items(pins) { pin ->
                        LegendPinItem(pin, { onPinClick(pin) }, pin.id in selectedNavPinIds, { s -> selectedNavPinIds = if (s) selectedNavPinIds + pin.id else selectedNavPinIds - pin.id }, { val idx = mapData.pins.indexOfFirst { it.id == pin.id }; if (idx > 0) viewModel.movePin(idx, idx - 1) }, { val idx = mapData.pins.indexOfFirst { it.id == pin.id }; if (idx < mapData.pins.size - 1) viewModel.movePin(idx, idx + 1) }, userRole)
                    }
                }
            }
        }
    }
}

@Composable
fun LegendGroupHeader(id: String?, name: String, isExpanded: Boolean, isVisible: Boolean, onToggle: () -> Unit, onToggleVisibility: () -> Unit, onUpdateName: (String) -> Unit = {}, onDelete: () -> Unit = {}, onNavigate: () -> Unit = {}, showSelectAll: Boolean = false, isAllSelected: Boolean = false, onSelectAll: (Boolean) -> Unit = {}, onMoveUp: () -> Unit = {}, onMoveDown: () -> Unit = {}, userRole: String? = "owner") {
    Surface(color = if (isExpanded) DarkSlateBlue.copy(alpha = 0.05f) else Color.Transparent, modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().clickable { onToggle() }.padding(vertical = 12.dp, horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onToggleVisibility, modifier = Modifier.size(24.dp)) { Icon(if (isVisible) Icons.Default.Visibility else Icons.Default.VisibilityOff, null, tint = DarkSlateBlue) }
            Spacer(modifier = Modifier.width(12.dp))
            Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (showSelectAll) Checkbox(checked = isAllSelected, onCheckedChange = onSelectAll, modifier = Modifier.size(24.dp), colors = CheckboxDefaults.colors(checkedColor = DarkSlateBlue))
            if (userRole != "view") {
                IconButton(onClick = onMoveUp, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.ArrowUpward, null, modifier = Modifier.size(18.dp)) }
                IconButton(onClick = onMoveDown, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.ArrowDownward, null, modifier = Modifier.size(18.dp)) }
            }
            Icon(if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null, tint = Color.Gray)
        }
    }
}

@Composable
fun LegendPinItem(pin: Pin, onClick: () -> Unit, isSelected: Boolean, onToggleSelect: (Boolean) -> Unit, onMoveUp: () -> Unit = {}, onMoveDown: () -> Unit = {}, userRole: String? = "owner") {
    val colorMap = mapOf("blue" to 0xFF2A81CB, "red" to 0xFFCB2B3E, "green" to 0xFF2AAD27, "orange" to 0xFFCB8427, "violet" to 0xFF9C2BCB, "gold" to 0xFFFFD700, "pink" to 0xFFFF69B4, "teal" to 0xFF008080, "brown" to 0xFF8B4513)
    val pinColor = remember(pin.color) {
        if (pin.color?.startsWith("#") == true) {
            try { Color(android.graphics.Color.parseColor(pin.color)) } catch (e: Exception) { Color(0xFF2A81CB) }
        } else {
            Color(colorMap[pin.color] ?: 0xFF2A81CB)
        }
    }
    val icon = when(pin.icon) { "hotel" -> Icons.Default.Bed; "restaurant" -> Icons.Default.Restaurant; "airport" -> Icons.Default.LocalAirport; "park" -> Icons.Default.Forest; "museum" -> Icons.Default.Museum; "shopping" -> Icons.Default.ShoppingBag; "camera" -> Icons.Default.PhotoCamera; "gas" -> Icons.Default.LocalGasStation; "charging" -> Icons.Default.Bolt; else -> Icons.Default.Place }
    ListItem(
        headlineContent = { Text(pin.label ?: "Pin", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) },
        supportingContent = if (!pin.description.isNullOrBlank()) { { Text(pin.description!!, style = MaterialTheme.typography.bodySmall, color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis) } } else null,
        leadingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = isSelected, onCheckedChange = onToggleSelect, colors = CheckboxDefaults.colors(checkedColor = DarkSlateBlue))
                Spacer(Modifier.width(8.dp))
                Surface(shape = CircleShape, color = pinColor.copy(alpha = 0.1f), modifier = Modifier.size(32.dp)) { Box(contentAlignment = Alignment.Center) { Icon(icon, null, modifier = Modifier.size(20.dp), tint = pinColor) } }
            }
        },
        trailingContent = if (userRole != "view") { { Row { IconButton(onClick = onMoveUp) { Icon(Icons.Default.ArrowUpward, null, modifier = Modifier.size(18.dp)) }; IconButton(onClick = onMoveDown) { Icon(Icons.Default.ArrowDownward, null, modifier = Modifier.size(18.dp)) } } } } else null,
        modifier = Modifier.fillMaxWidth().clickable { onClick() },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent)
    )
}
