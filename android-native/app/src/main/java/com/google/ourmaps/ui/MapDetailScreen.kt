package com.google.ourmaps.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.ourmaps.model.Pin
import com.google.ourmaps.viewmodel.MapDetailViewModel
import com.google.ourmaps.viewmodel.UiState
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapDetailScreen(
    mapId: String,
    viewModel: MapDetailViewModel = viewModel(),
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(mapId) {
        viewModel.loadMap(mapId)
    }

    Scaffold(
        topBar = {
            // Title will be updated when map loads
            val title = (uiState as? UiState.Success)?.data?.name ?: "Loading..."
            CenterAlignedTopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    Button(onClick = onBack) { Text("Back") }
                }
            )
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding)) {
            when (val state = uiState) {
                is UiState.Loading -> {
                    CircularProgressIndicator(modifier = Modifier.align(androidx.compose.ui.Alignment.Center))
                }
                is UiState.Error -> {
                    Text("Error: ${state.message}", modifier = Modifier.align(androidx.compose.ui.Alignment.Center))
                }
                is UiState.Success -> {
                    val mapData = state.data
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { context ->
                            MapView(context).apply {
                                setTileSource(TileSourceFactory.MAPNIK)
                                setMultiTouchControls(true)
                            }
                        },
                        update = { mapView ->
                            mapView.overlays.clear()
                            mapData.pins.forEach { pin ->
                                val marker = Marker(mapView)
                                marker.position = GeoPoint(pin.lat, pin.lng)
                                marker.title = pin.label
                                marker.snippet = pin.description
                                mapView.overlays.add(marker)
                            }
                            if (mapData.pins.isNotEmpty()) {
                                mapView.controller.setCenter(GeoPoint(mapData.pins[0].lat, mapData.pins[0].lng))
                                mapView.controller.setZoom(10.0)
                            }
                        }
                    )
                    
                    // Bottom Sheet for Map Details (Simplified for MVP)
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .align(androidx.compose.ui.Alignment.BottomCenter)
                            .height(200.dp),
                        color = Color.White,
                        shadowElevation = 8.dp
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text("Map: ${mapData.name}", style = MaterialTheme.typography.titleLarge)
                            Text("${mapData.pins.size} Pins", style = MaterialTheme.typography.bodyMedium)
                            // Add buttons for Export/Share here
                        }
                    }
                }
            }
        }
    }
}
