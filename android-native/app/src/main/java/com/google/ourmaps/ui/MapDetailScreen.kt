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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.core.content.ContextCompat
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import org.osmdroid.views.Projection
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker
import java.io.OutputStream
import kotlinx.coroutines.launch
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
    val coroutineScope = rememberCoroutineScope()
    
    // Custom TileSource that allows bulk downloading
    val permissiveTileSource = remember {
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

    // Layer / Group visibility
    var visibleGroupIds by remember { mutableStateOf<Set<String?>>(emptySet()) }

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
    
    val scaffoldState = rememberBottomSheetScaffoldState()
    val density = LocalDensity.current
    var peekHeightPx by remember { mutableIntStateOf(0) }
    val sheetPeekHeight = remember(peekHeightPx) { with(density) { (peekHeightPx).toDp() + 48.dp } } // Increased buffer

    BackHandler(enabled = selectedPin != null || isSearching || scaffoldState.bottomSheetState.currentValue == SheetValue.Expanded) {
        if (scaffoldState.bottomSheetState.currentValue == SheetValue.Expanded) {
            coroutineScope.launch { scaffoldState.bottomSheetState.partialExpand() }
        } else if (isSearching) {
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

    // Refresh offline status when download completes
    LaunchedEffect(downloadProgress) {
        if (downloadProgress >= 1.0f) {
            isOfflineAvailable = OfflineManager.isMapDownloaded(context, mapId)
        }
    }
    
    // Track if we've already auto-zoomed for the current map
    var hasAutoZoomed by rememberSaveable(mapId) { mutableStateOf(false) }

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
                    
                    val permissionsList = mapData?.permissions ?: emptyList()
                    if (permissionsList.isEmpty()) {
                        Text("Only you have access", style = MaterialTheme.typography.bodyMedium, color = Color.Gray)
                    } else {
                        LazyColumn(modifier = Modifier.heightIn(max = 200.dp)) {
                            items(permissionsList) { permission ->
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(permission.userName ?: permission.userEmail, style = MaterialTheme.typography.bodyMedium)
                                        Text(permission.role.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                                    }
                                    if (mapData?.userRole == "owner") {
                                        IconButton(onClick = {
                                            viewModel.removeShare(permission.userId) {
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

    BottomSheetScaffold(
        scaffoldState = scaffoldState,
        sheetPeekHeight = sheetPeekHeight,
        sheetContainerColor = Color.White,
        sheetShape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        sheetDragHandle = {
            Box(
                modifier = Modifier
                    .padding(vertical = 12.dp)
                    .width(40.dp)
                    .height(4.dp)
                    .background(Color.LightGray, RoundedCornerShape(2.dp))
            )
        },
        sheetContent = {
            if (uiState is UiState.Success) {
                val mapData = (uiState as UiState.Success).data
                Column(modifier = Modifier.fillMaxWidth()) {
                    // Peek Portion
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp)
                            .padding(bottom = 16.dp) // Extra room
                            .onGloballyPositioned { layoutCoordinates ->
                                peekHeightPx = layoutCoordinates.size.height
                            }
                    ) {
                        if (selectedPin != null) {
                            val pin = mapData.pins.find { it.id == selectedPin?.id } ?: selectedPin!!
                            
                            if (!isEditingPin) {
                                // View Mode
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(pin.label ?: "Unnamed Pin", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                    IconButton(onClick = { selectedPin = null }) { Icon(Icons.Default.Close, contentDescription = "Close") }
                                }
                                
                                if (!pin.address.isNullOrBlank()) {
                                    Text(pin.address!!, style = MaterialTheme.typography.bodyMedium, color = Color.Gray, modifier = Modifier.padding(vertical = 4.dp))
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
                                var editedAddress by remember(pin.id) { mutableStateOf(pin.address ?: "") }
                                var editedDescription by remember(pin.id) { mutableStateOf(pin.description ?: "") }
                                var editedColor by remember(pin.id) { mutableStateOf(pin.color ?: "blue") }
                                var editedIcon by remember(pin.id) { mutableStateOf(pin.icon ?: "default") }
                                val updatePinFn = { l: String, a: String, d: String, c: String, i: String, g: String? ->
                                    viewModel.updateMap(mapData.copy(pins = mapData.pins.map { if (it.id == pin.id) it.copy(label = l, address = a, description = d, color = c, icon = i, groupId = g) else it }))
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("Edit Pin", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                    IconButton(onClick = { 
                                        viewModel.updateMap(mapData.copy(pins = mapData.pins.filter { it.id != pin.id }))
                                        selectedPin = null 
                                    }) { Icon(Icons.Default.Delete, contentDescription = "Delete", tint = Color.Red) }
                                }
                                OutlinedTextField(value = editedLabel, onValueChange = { editedLabel = it; updatePinFn(it, editedAddress, editedDescription, editedColor, editedIcon, pin.groupId) }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
                                Spacer(modifier = Modifier.height(8.dp))
                                OutlinedTextField(value = editedAddress, onValueChange = { editedAddress = it; updatePinFn(editedLabel, it, editedDescription, editedColor, editedIcon, pin.groupId) }, label = { Text("Address") }, modifier = Modifier.fillMaxWidth())
                                Spacer(modifier = Modifier.height(8.dp))
                                OutlinedTextField(value = editedDescription, onValueChange = { editedDescription = it; updatePinFn(editedLabel, editedAddress, it, editedColor, editedIcon, pin.groupId) }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
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
                                        DropdownMenuItem(text = { Text("No Group (Default)") }, onClick = { updatePinFn(editedLabel, editedAddress, editedDescription, editedColor, editedIcon, null); showGroupDropdown = false })
                                        mapData.groups.forEach { g -> DropdownMenuItem(text = { Text(g.name) }, onClick = { updatePinFn(editedLabel, editedAddress, editedDescription, editedColor, editedIcon, g.id); showGroupDropdown = false }) }
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
                                    val colors = mapOf("blue" to Color(0xFF2A81CB), "red" to Color(0xFFCB2B3E), "green" to Color(0xFF2AAD27), "orange" to Color(0xFFCB8427), "violet" to Color(0xFF9C2BCB), "gold" to Color(0xFFFFD700), "pink" to Color(0xFFFF69B4), "teal" to Color(0xFF008080), "brown" to Color(0xFF8B4513))
                                    colors.forEach { (n, v) -> Box(modifier = Modifier.size(36.dp).background(v, CircleShape).clickable { editedColor = n; updatePinFn(editedLabel, editedAddress, editedDescription, n, editedIcon, pin.groupId) }.padding(4.dp)) { if (editedColor == n) Icon(Icons.Default.Check, null, tint = Color.White, modifier = Modifier.size(20.dp).align(Alignment.Center)) } }
                                }
                                Spacer(modifier = Modifier.height(8.dp))
                                Text("Icon", style = MaterialTheme.typography.labelMedium)
                                Column {
                                    listOf(listOf("default", "hotel", "restaurant", "airport"), listOf("park", "museum", "shopping", "camera")).forEach { row ->
                                        Row(modifier = Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            row.forEach { t -> FilterChip(selected = editedIcon == t, onClick = { editedIcon = t; updatePinFn(editedLabel, editedAddress, editedDescription, editedColor, t, pin.groupId) }, label = { Text(t.replaceFirstChar { it.uppercase() }, fontSize = 10.sp) }) }
                                        }
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

                    // Legend portion (only visible when expanded or scrollable)
                    Divider(modifier = Modifier.padding(vertical = 16.dp))
                    LegendContent(
                        mapData = mapData,
                        visibleGroupIds = visibleGroupIds,
                        onToggleGroupVisibility = { id ->
                            visibleGroupIds = if (visibleGroupIds.contains(id)) visibleGroupIds - id else visibleGroupIds + id
                        },
                        onUpdateGroup = { id, newName ->
                            val updatedGroups = mapData.groups.map { 
                                if (it.id == id) it.copy(name = newName) else it 
                            }
                            viewModel.updateMap(mapData.copy(groups = updatedGroups))
                        },
                        onRemoveGroup = { id ->
                            // Move pins in this group back to default
                            val updatedPins = mapData.pins.map { 
                                if (it.groupId == id) it.copy(groupId = null) else it 
                            }
                            val updatedGroups = mapData.groups.filter { it.id != id }
                            visibleGroupIds = visibleGroupIds - id
                            viewModel.updateMap(mapData.copy(groups = updatedGroups, pins = updatedPins))
                        },
                        onPinClick = { pin ->
                            selectedPin = pin
                            isEditingPin = false
                            coroutineScope.launch { scaffoldState.bottomSheetState.partialExpand() }
                        },
                        userRole = mapData.userRole
                    )
                }
            } else {
                // Empty content for loading/error states
                Box(modifier = Modifier.fillMaxWidth().height(100.dp))
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize().background(LightGray)) {
            val mapName = (uiState as? UiState.Success)?.data?.name ?: "Loading..."
            
            Column {
                CenterAlignedTopAppBar(
                    title = { 
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Place, contentDescription = null, modifier = Modifier.size(20.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(mapName, fontWeight = FontWeight.Bold)
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

                                        // Add buffer to map extent
                                        val boundingBox = BoundingBox(
                                            Math.min(85.0, rawBbox.latNorth + 0.05),
                                            Math.min(180.0, rawBbox.lonEast + 0.05),
                                            Math.max(-85.0, rawBbox.latSouth - 0.05),
                                            Math.max(-180.0, rawBbox.lonWest - 0.05)
                                        )

                                        // Broad detail for map extent (1-12)
                                        var totalTiles = TileCalculator.countTiles(boundingBox, 1, 12)
                                        // High detail for clusters (13-17) - Surgical around pins
                                        state.data.pins.forEach { pin ->
                                            totalTiles += TileCalculator.countTiles(BoundingBox(pin.lat + 0.01, pin.lng + 0.01, pin.lat - 0.01, pin.lng - 0.01), 13, 17)
                                        }

                                        val maxTiles = 30000
                                        if (totalTiles > maxTiles) {
                                            Toast.makeText(context, "The map area is too large to download ($totalTiles tiles). Please zoom in. (Max $maxTiles tiles)", Toast.LENGTH_LONG).show()
                                        } else {
                                            downloadSummary = DownloadSummary(totalTiles, TileCalculator.estimateSizeMB(totalTiles), boundingBox)
                                            showDownloadConfirm = true
                                        }
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

                Box(modifier = Modifier.weight(1f).clip(RectangleShape)) {
                    if (uiState is UiState.Success) {
                        AndroidView(
                            modifier = Modifier.fillMaxSize().clip(RectangleShape),
                            factory = { ctx ->
                                MapView(ctx).apply {
                                    setTileSource(permissiveTileSource)
                                    setMultiTouchControls(true)
                                    zoomController.setVisibility(org.osmdroid.views.CustomZoomButtonsController.Visibility.NEVER)
                                    setUseDataConnection(true)

                                    // Fix position shifting on zoom and world repetition
                                    isTilesScaledToDpi = false
                                    
                                    // Enforce limits strictly
                                    minZoomLevel = 2.0
                                    maxZoomLevel = 20.0
                                    isHorizontalMapRepetitionEnabled = false
                                    isVerticalMapRepetitionEnabled = false
                                    
                                    // Limit pan to world bounds
                                    setScrollableAreaLimitDouble(BoundingBox(85.0, 180.0, -85.0, -180.0))

                                    mapViewRef = this
                                    val locOverlay = MyLocationNewOverlay(GpsMyLocationProvider(ctx), this)
                                    locOverlay.enableMyLocation()

                                        // Set custom blue dot icon
                                        ContextCompat.getDrawable(ctx, com.google.ourmaps.R.drawable.blue_dot)?.let { drawable ->
                                            val bitmap = MarkerUtils.drawableToBitmap(drawable)
                                            locOverlay.setPersonIcon(bitmap)
                                            locOverlay.setDirectionIcon(bitmap)
                                            // Center the icon so it doesn't drift on zoom
                                            locOverlay.setPersonAnchor(0.5f, 0.5f)
                                            locOverlay.setDirectionAnchor(0.5f, 0.5f)
                                        }

                                        locationOverlay = locOverlay
                                        overlays.add(locOverlay)

                                        val eventsOverlay = MapEventsOverlay(object : MapEventsReceiver {
                                            override fun singleTapConfirmedHelper(p: GeoPoint?): Boolean {
                                                selectedPin = null
                                                coroutineScope.launch { scaffoldState.bottomSheetState.partialExpand() }
                                                overlays.forEach { if (it is Marker) it.closeInfoWindow() }
                                                return true
                                            }
                                            override fun longPressHelper(p: GeoPoint?): Boolean {
                                                p?.let {
                                                val currentMap = (viewModel.uiState.value as? UiState.Success)?.data ?: return@let
                                                val newPin = Pin(
                                                    id = java.util.UUID.randomUUID().toString(),
                                                    lat = it.latitude,
                                                    lng = it.longitude,
                                                    label = "New Pin",
                                                    description = "",
                                                    address = null,
                                                    imageUrl = null,
                                                    color = "blue",
                                                    icon = "default",
                                                    groupId = null,
                                                    position = currentMap.pins.size
                                                )
                                                viewModel.updateMap(currentMap.copy(pins = currentMap.pins + newPin))
                                            }
                                            return true
                                        }
                                    })
                                    overlays.add(eventsOverlay)
                                }
                            },
                            update = { mv ->
                                val successState = uiState as? UiState.Success ?: return@AndroidView
                                val currentMapData = successState.data

                                // Re-enforce limits (critical for rotation stability)
                                mv.isTilesScaledToDpi = false
                                mv.minZoomLevel = 2.0
                                mv.maxZoomLevel = 20.0
                                mv.isHorizontalMapRepetitionEnabled = false
                                mv.isVerticalMapRepetitionEnabled = false
                                mv.setScrollableAreaLimitDouble(BoundingBox(85.0, 180.0, -85.0, -180.0))

                                // Ensure current zoom isn't illegal (happens on rotation before limits apply)
                                if (mv.zoomLevelDouble < mv.minZoomLevel) {
                                    mv.controller.setZoom(mv.minZoomLevel)
                                }
                                // Remove all markers but keep location and event overlays
                                val markersToRemove = mv.overlays.filterIsInstance<Marker>()
                                markersToRemove.forEach { it.closeInfoWindow() }
                                mv.overlays.removeAll(markersToRemove)
                                
                                currentMapData.pins.filter { it.groupId in visibleGroupIds }.forEach { pin ->
                                    val marker = Marker(mv).apply {
                                        position = GeoPoint(pin.lat, pin.lng)
                                        setTitle(pin.label ?: "Unnamed Pin")
                                        setSnippet(pin.description ?: "")
                                        icon = MarkerUtils.getColoredMarker(context, pin.color ?: "blue", pin.icon ?: "default")
                                        setOnMarkerClickListener { m, _ ->
                                            selectedPin = pin
                                            isEditingPin = false
                                            coroutineScope.launch { scaffoldState.bottomSheetState.partialExpand() }
                                            m.showInfoWindow()
                                            true
                                        }
                                    }
                                    mv.overlays.add(marker)
                                }
                                mv.invalidate()
                                if (!hasAutoZoomed && currentMapData.pins.isNotEmpty()) {
                                    if (currentMapData.pins.size == 1) {
                                        mv.controller.setCenter(GeoPoint(currentMapData.pins[0].lat, currentMapData.pins[0].lng))
                                        mv.controller.setZoom(15.0)
                                        hasAutoZoomed = true
                                    } else {
                                        if (mv.width > 0 && mv.height > 0) {
                                            try {
                                                mv.zoomToBoundingBox(BoundingBox.fromGeoPoints(currentMapData.pins.map { GeoPoint(it.lat, it.lng) }), true, 100)
                                                hasAutoZoomed = true
                                            } catch (e: Exception) { }
                                        } else {
                                            mv.addOnLayoutChangeListener(object : android.view.View.OnLayoutChangeListener {
                                                override fun onLayoutChange(v: android.view.View, l: Int, t: Int, r: Int, b: Int, ol: Int, ot: Int, or: Int, ob: Int) {
                                                    mv.removeOnLayoutChangeListener(this)
                                                    try { mv.zoomToBoundingBox(BoundingBox.fromGeoPoints(currentMapData.pins.map { GeoPoint(it.lat, it.lng) }), true, 100); hasAutoZoomed = true } catch (e: Exception) {}
                                                }
                                            })
                                        }
                                    }
                                } else if (!hasAutoZoomed && currentMapData.pins.isEmpty()) {
                                    mv.controller.setZoom(3.0); mv.controller.setCenter(GeoPoint(20.0, 0.0)); hasAutoZoomed = true
                                }
                            }
                        )

                        // Offline Indicator Chip on Map
                        if (isOfflineAvailable) {
                            Surface(
                                modifier = Modifier
                                    .align(Alignment.TopStart)
                                    .padding(12.dp),
                                color = Color.White.copy(alpha = 0.9f),
                                shape = RoundedCornerShape(16.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, SuccessGreen.copy(alpha = 0.5f)),
                                shadowElevation = 2.dp
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.CloudDone, 
                                        contentDescription = null, 
                                        tint = SuccessGreen,
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        "Offline Map Ready", 
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = DarkSlateBlue
                                    )
                                }
                            }
                        }
                    } else if (uiState is UiState.Loading) {
                        CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                    } else if (uiState is UiState.Error) {
                        Text("Error: ${(uiState as UiState.Error).message}", modifier = Modifier.align(Alignment.Center), color = Color.Red)
                    }
                    
                    // Floating Action Buttons
                    Column(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(16.dp),
                        horizontalAlignment = Alignment.End
                    ) {
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
            }

            if (isSearching) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val mapData = (uiState as? UiState.Success)?.data
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
                                        if (mapData != null) {
                                            val newPin = Pin(
                                                id = java.util.UUID.randomUUID().toString(),
                                                lat = result.location.latitude,
                                                lng = result.location.longitude,
                                                label = result.name,
                                                description = result.description,
                                                address = result.description, // Use search description as address
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

@Composable
fun LegendContent(
    mapData: com.google.ourmaps.model.MapData,
    visibleGroupIds: Set<String?>,
    onToggleGroupVisibility: (String?) -> Unit,
    onUpdateGroup: (String, String) -> Unit,
    onRemoveGroup: (String) -> Unit,
    onPinClick: (Pin) -> Unit,
    userRole: String?
) {
    var expandedGroupIds by remember { mutableStateOf<Set<String?>>(visibleGroupIds) }
    var selectedNavPinIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    
    // State for navigation origin dialog
    var showNavigationDialog by remember { mutableStateOf(false) }
    var pinsToNavigate by remember { mutableStateOf<List<Pin>>(emptyList()) }
    
    val context = LocalContext.current

    val performNavigation = { useCurrentLocation: Boolean ->
        if (pinsToNavigate.isNotEmpty()) {
            val uriString = com.google.ourmaps.utils.NavigationUtils.generateNavigationUri(pinsToNavigate, useCurrentLocation)
            val uri = Uri.parse(uriString)
            val intent = Intent(Intent.ACTION_VIEW, uri).apply { setPackage("com.google.android.apps.maps") }
            try { context.startActivity(intent) } catch (e: Exception) { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            pinsToNavigate = emptyList()
        }
    }

    if (showNavigationDialog) {
        AlertDialog(
            onDismissRequest = { showNavigationDialog = false },
            title = { Text("Navigation Origin") },
            text = { Text("Would you like to start navigation from your current location?") },
            confirmButton = {
                TextButton(onClick = { 
                    showNavigationDialog = false
                    performNavigation(true)
                }) {
                    Text("Current Location")
                }
            },
            dismissButton = {
                TextButton(onClick = { 
                    showNavigationDialog = false
                    performNavigation(false)
                }) {
                    Text("First Pin")
                }
            }
        )
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Map Legend", 
                style = MaterialTheme.typography.headlineSmall, 
                fontWeight = FontWeight.Bold
            )
            
            if (selectedNavPinIds.isNotEmpty()) {
                Button(
                    onClick = { 
                        pinsToNavigate = mapData.pins.filter { it.id in selectedNavPinIds }
                            .sortedWith(compareBy({ it.groupId }, { it.position }))
                        showNavigationDialog = true 
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DarkSlateBlue),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    modifier = Modifier.height(32.dp)
                ) {
                    Icon(Icons.Default.Directions, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Go (${selectedNavPinIds.size})", fontSize = 12.sp)
                }
            }
        }
        
        LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 600.dp)) {
            // Default Group
            item {
                val defaultPins = mapData.pins.filter { it.groupId == null }
                LegendGroupHeader(
                    id = null,
                    name = "Default Layer",
                    isExpanded = expandedGroupIds.contains(null),
                    isVisible = visibleGroupIds.contains(null),
                    onToggle = { 
                        expandedGroupIds = if (expandedGroupIds.contains(null)) expandedGroupIds - null else expandedGroupIds + null
                    },
                    onToggleVisibility = { onToggleGroupVisibility(null) },
                    onNavigate = {
                        val groupPins = mapData.pins.filter { it.groupId == null }
                        if (groupPins.isNotEmpty()) {
                            pinsToNavigate = groupPins
                            showNavigationDialog = true
                        } else {
                            Toast.makeText(context, "No pins in this layer", Toast.LENGTH_SHORT).show()
                        }
                    },
                    showSelectAll = defaultPins.isNotEmpty() && expandedGroupIds.contains(null),
                    isAllSelected = defaultPins.isNotEmpty() && defaultPins.all { it.id in selectedNavPinIds },
                    onSelectAll = { select ->
                        val ids = defaultPins.map { it.id }.toSet()
                        selectedNavPinIds = if (select) selectedNavPinIds + ids else selectedNavPinIds - ids
                    },
                    userRole = userRole
                )
            }
            
            val defaultPins = mapData.pins.filter { it.groupId == null }
            if (expandedGroupIds.contains(null)) {
                if (defaultPins.isEmpty()) {
                    item { Text("No pins in this layer", modifier = Modifier.padding(start = 72.dp, bottom = 16.dp, top = 8.dp), style = MaterialTheme.typography.bodySmall, color = Color.Gray) }
                } else {
                    items(defaultPins) { pin ->
                        LegendPinItem(
                            pin = pin, 
                            onClick = { onPinClick(pin) },
                            isSelected = pin.id in selectedNavPinIds,
                            onToggleSelect = { selected ->
                                selectedNavPinIds = if (selected) selectedNavPinIds + pin.id else selectedNavPinIds - pin.id
                            }
                        )
                        Divider(modifier = Modifier.padding(start = 72.dp, end = 16.dp), thickness = 0.5.dp, color = Color.LightGray.copy(alpha = 0.5f))
                    }
                }
            }
            
            // Other Groups
            mapData.groups.forEach { group ->
                val groupPins = mapData.pins.filter { it.groupId == group.id }
                item {
                    LegendGroupHeader(
                        id = group.id,
                        name = group.name,
                        isExpanded = expandedGroupIds.contains(group.id),
                        isVisible = visibleGroupIds.contains(group.id),
                        onToggle = { 
                            expandedGroupIds = if (expandedGroupIds.contains(group.id)) expandedGroupIds - group.id else expandedGroupIds + group.id
                        },
                        onToggleVisibility = { onToggleGroupVisibility(group.id) },
                        onUpdateName = { onUpdateGroup(group.id, it) },
                        onDelete = { onRemoveGroup(group.id) },
                        onNavigate = {
                            if (groupPins.isNotEmpty()) {
                                pinsToNavigate = groupPins
                                showNavigationDialog = true
                            } else {
                                Toast.makeText(context, "No pins in this layer", Toast.LENGTH_SHORT).show()
                            }
                        },
                        showSelectAll = groupPins.isNotEmpty() && expandedGroupIds.contains(group.id),
                        isAllSelected = groupPins.isNotEmpty() && groupPins.all { it.id in selectedNavPinIds },
                        onSelectAll = { select ->
                            val ids = groupPins.map { it.id }.toSet()
                            selectedNavPinIds = if (select) selectedNavPinIds + ids else selectedNavPinIds - ids
                        },
                        userRole = userRole
                    )
                }
                
                if (expandedGroupIds.contains(group.id)) {
                    if (groupPins.isEmpty()) {
                        item { Text("No pins in this layer", modifier = Modifier.padding(start = 72.dp, bottom = 16.dp, top = 8.dp), style = MaterialTheme.typography.bodySmall, color = Color.Gray) }
                    } else {
                        items(groupPins) { pin ->
                            LegendPinItem(
                                pin = pin, 
                                onClick = { onPinClick(pin) },
                                isSelected = pin.id in selectedNavPinIds,
                                onToggleSelect = { selected ->
                                    selectedNavPinIds = if (selected) selectedNavPinIds + pin.id else selectedNavPinIds - pin.id
                                }
                            )
                            Divider(modifier = Modifier.padding(start = 72.dp, end = 16.dp), thickness = 0.5.dp, color = Color.LightGray.copy(alpha = 0.5f))
                        }
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
fun LegendGroupHeader(
    id: String?,
    name: String, 
    isExpanded: Boolean, 
    isVisible: Boolean,
    onToggle: () -> Unit,
    onToggleVisibility: () -> Unit,
    onUpdateName: (String) -> Unit = {},
    onDelete: () -> Unit = {},
    onNavigate: () -> Unit = {},
    showSelectAll: Boolean = false,
    isAllSelected: Boolean = false,
    onSelectAll: (Boolean) -> Unit = {},
    userRole: String? = "owner"
) {
    var showMenu by remember { mutableStateOf(false) }
    var isRenaming by remember { mutableStateOf(false) }
    var editedName by remember(name) { mutableStateOf(name) }

    Surface(
        color = if (isExpanded) DarkSlateBlue.copy(alpha = 0.05f) else Color.Transparent,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically, 
            modifier = Modifier.fillMaxWidth().clickable { onToggle() }.padding(vertical = 12.dp, horizontal = 16.dp)
        ) {
            Box {
                IconButton(
                    onClick = { showMenu = true },
                    modifier = Modifier.size(24.dp)
                ) {
                    Icon(
                        Icons.Default.Layers, 
                        contentDescription = "Layer Options", 
                        modifier = Modifier.size(24.dp), 
                        tint = if (isVisible) DarkSlateBlue else DarkSlateBlue.copy(alpha = 0.4f)
                    )
                }
                
                DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                    DropdownMenuItem(
                        text = { Text(if (isVisible) "Hide on Map" else "Show on Map") },
                        onClick = {
                            showMenu = false
                            onToggleVisibility()
                        },
                        leadingIcon = { Icon(if (isVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility, null) }
                    )
                    DropdownMenuItem(
                        text = { Text("Directions") },
                        onClick = {
                            showMenu = false
                            onNavigate()
                        },
                        leadingIcon = { Icon(Icons.Default.Route, null) }
                    )
                    
                    if (id != null && (userRole == "owner" || userRole == "edit")) {
                        Divider()
                        DropdownMenuItem(
                            text = { Text("Rename Layer") },
                            onClick = {
                                showMenu = false
                                isRenaming = true
                            },
                            leadingIcon = { Icon(Icons.Default.Edit, null) }
                        )
                        DropdownMenuItem(
                            text = { Text("Delete Layer") },
                            onClick = {
                                showMenu = false
                                onDelete()
                            },
                            leadingIcon = { Icon(Icons.Default.Delete, null, tint = Color.Red) }
                        )
                    }
                }
            }
            
            Spacer(modifier = Modifier.width(12.dp))
            
            if (isRenaming) {
                OutlinedTextField(
                    value = editedName,
                    onValueChange = { editedName = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    trailingIcon = {
                        IconButton(onClick = {
                            onUpdateName(editedName)
                            isRenaming = false
                        }) {
                            Icon(Icons.Default.Check, contentDescription = "Save")
                        }
                    }
                )
            } else {
                Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            }
            
            if (showSelectAll && !isRenaming) {
                Checkbox(
                    checked = isAllSelected, 
                    onCheckedChange = onSelectAll,
                    modifier = Modifier.padding(end = 8.dp).size(24.dp),
                    colors = CheckboxDefaults.colors(checkedColor = DarkSlateBlue)
                )
            }
            
            if (!isRenaming) {
                Icon(if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, contentDescription = null, tint = Color.Gray)
            }
        }
    }
}

@Composable
fun LegendPinItem(
    pin: Pin, 
    onClick: () -> Unit,
    isSelected: Boolean,
    onToggleSelect: (Boolean) -> Unit
) {
    val pinColor = Color(when(pin.color) {
        "red" -> 0xFFCB2B3E
        "green" -> 0xFF2AAD27
        "orange" -> 0xFFCB8427
        "violet" -> 0xFF9C2BCB
        "gold", "yellow" -> 0xFFFFD700
        "pink" -> 0xFFFF69B4
        "teal" -> 0xFF008080
        "brown" -> 0xFF8B4513
        else -> 0xFF2A81CB
    })

    ListItem(
        headlineContent = { 
            Text(
                pin.label ?: "Unnamed Pin", 
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            ) 
        },
        supportingContent = if (!pin.description.isNullOrBlank()) {
            { 
                Text(
                    pin.description!!, 
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.Gray,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                ) 
            }
        } else null,
        leadingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = isSelected, 
                    onCheckedChange = onToggleSelect,
                    colors = CheckboxDefaults.colors(checkedColor = DarkSlateBlue)
                )
                Spacer(Modifier.width(8.dp))
                Surface(
                    shape = CircleShape,
                    color = pinColor.copy(alpha = 0.1f),
                    modifier = Modifier.size(32.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Place,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                            tint = pinColor
                        )
                    }
                }
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 0.dp),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent)
    )
}
