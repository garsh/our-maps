package com.google.ourmaps.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.google.ourmaps.model.MapData
import com.google.ourmaps.repository.MapRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject

sealed class UiState<out T> {
    object Loading : UiState<Nothing>()
    data class Success<T>(val data: T) : UiState<T>()
    data class Error(val message: String) : UiState<Nothing>()
}

class MapListViewModel(private val repository: MapRepository) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<List<MapData>>>(UiState.Loading)
    val uiState: StateFlow<UiState<List<MapData>>> = _uiState.asStateFlow()

    init {
        fetchMaps()
    }

    fun fetchMaps() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading
            val result = repository.getMaps()
            result.onSuccess { maps ->
                val sortedMaps = maps.sortedByDescending { it.lastAccessedAt }
                _uiState.value = UiState.Success(sortedMaps)
            }.onFailure { e ->
                _uiState.value = UiState.Error(e.message ?: "Unknown error")
            }
        }
    }

    fun createMap(name: String, onSuccess: (String) -> Unit) {
        viewModelScope.launch {
            val newMap = MapData(
                id = java.util.UUID.randomUUID().toString(),
                name = name,
                ownerId = "me",
                ownerName = null,
                ownerEmail = null,
                groups = emptyList(),
                pins = emptyList(),
                userRole = "owner",
                permissions = null,
                lastAccessedAt = null
            )
            val result = repository.createMap(newMap)
            result.onSuccess { createdMap ->
                fetchMaps()
                onSuccess(createdMap.id)
            }
        }
    }

    fun importMap(mapData: MapData, onSuccess: (String) -> Unit) {
        viewModelScope.launch {
            val result = repository.createMap(mapData)
            result.onSuccess { createdMap ->
                fetchMaps()
                onSuccess(createdMap.id)
            }
        }
    }

    fun deleteMap(id: String, onSuccess: () -> Unit) {
        viewModelScope.launch {
            val result = repository.deleteMap(id)
            result.onSuccess {
                fetchMaps()
                onSuccess()
            }
        }
    }
}

class MapDetailViewModel(
    private val repository: MapRepository,
    private val context: android.content.Context
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<MapData>>(UiState.Loading)
    val uiState: StateFlow<UiState<MapData>> = _uiState.asStateFlow()
    
    private var socket: Socket? = null

    fun loadMap(id: String, silent: Boolean = false) {
        android.util.Log.d("OURMAPS_DEBUG", "ViewModel: loadMap($id, silent=$silent)")
        viewModelScope.launch {
            if (!silent) _uiState.value = UiState.Loading
            val result = repository.getMap(id)
            result.onSuccess { map ->
                android.util.Log.d("OURMAPS_DEBUG", "ViewModel: loadMap success for $id")
                _uiState.value = UiState.Success(map)
                
                // Setup Real-time Sync
                setupSocket(id)

                // Auto-sync: if this map is already downloaded, update the local metadata cache
                if (com.google.ourmaps.utils.OfflineManager.isMapDownloaded(context, id)) {
                    com.google.ourmaps.utils.OfflineManager.saveMapOffline(context, map)
                }
            }.onFailure { e ->
                android.util.Log.e("OURMAPS_DEBUG", "ViewModel: loadMap failure for $id", e)
                if (!silent) _uiState.value = UiState.Error(e.message ?: "Unknown error")
            }
        }
    }

    private fun setupSocket(mapId: String) {
        if (socket != null) {
            android.util.Log.d("OURMAPS_DEBUG", "ViewModel: Socket already exists, skipping setup")
            return
        }
        
        try {
            android.util.Log.d("OURMAPS_DEBUG", "ViewModel: Setting up socket for $mapId")
            val opts = IO.Options()
            opts.path = "/socket.io"
            opts.transports = arrayOf("websocket", "polling")
            
            val socketUrl = context.getString(com.google.ourmaps.R.string.api_base_url).removeSuffix("/api/")
            android.util.Log.d("OURMAPS_DEBUG", "ViewModel: Socket URL: $socketUrl")
            socket = IO.socket(socketUrl, opts)
            
            socket?.on(Socket.EVENT_CONNECT) {
                android.util.Log.d("OURMAPS_DEBUG", "ViewModel: Socket connected, joining room map:$mapId")
                socket?.emit("join-map", mapId)
            }
            
            socket?.on("map-remote-updated") { args ->
                android.util.Log.d("OURMAPS_DEBUG", "ViewModel: Socket remote update received")
                // Trigger a silent reload to get latest state from server
                viewModelScope.launch {
                    loadMap(mapId, silent = true)
                }
            }
            
            socket?.connect()
        } catch (e: Exception) {
            android.util.Log.e("OURMAPS_DEBUG", "ViewModel: Socket setup failed", e)
        }
    }

    override fun onCleared() {
        super.onCleared()
        socket?.disconnect()
        socket = null
    }

    fun updateMap(mapData: MapData) {
        viewModelScope.launch {
            val result = repository.updateMap(mapData.id, mapData)
            result.onSuccess {
                _uiState.value = UiState.Success(mapData)
                
                // Notify others via socket
                val gson = com.google.gson.Gson()
                socket?.emit("map-updated", JSONObject().apply {
                    put("mapId", mapData.id)
                    put("name", mapData.name)
                    put("pins", org.json.JSONArray(gson.toJson(mapData.pins)))
                    put("groups", org.json.JSONArray(gson.toJson(mapData.groups)))
                })

                // Auto-sync: update local cache immediately on save
                if (com.google.ourmaps.utils.OfflineManager.isMapDownloaded(context, mapData.id)) {
                    com.google.ourmaps.utils.OfflineManager.saveMapOffline(context, mapData)
                }
            }
        }
    }

    fun deleteMap(id: String, onSuccess: () -> Unit) {
        viewModelScope.launch {
            val result = repository.deleteMap(id)
            result.onSuccess { 
                onSuccess() 
            }
        }
    }

    fun shareMap(email: String, role: String, onSuccess: () -> Unit) {
        val state = _uiState.value
        if (state is UiState.Success) {
            viewModelScope.launch {
                val result = repository.shareMap(state.data.id, email, role)
                result.onSuccess { 
                    loadMap(state.data.id, silent = true) 
                    onSuccess() 
                }
            }
        }
    }

    fun removeShare(userId: String, onSuccess: () -> Unit) {
        val state = _uiState.value
        if (state is UiState.Success) {
            viewModelScope.launch {
                val result = repository.removeShare(state.data.id, userId)
                result.onSuccess {
                    loadMap(state.data.id, silent = true) 
                    onSuccess()
                }
            }
        }
    }

    fun movePin(fromIndex: Int, toIndex: Int) {
        val state = _uiState.value
        if (state is UiState.Success) {
            val pins = state.data.pins.toMutableList()
            if (fromIndex !in pins.indices || toIndex !in pins.indices) return
            
            val pin = pins.removeAt(fromIndex)
            pins.add(toIndex, pin)
            
            val updatedPins = pins.mapIndexed { index, p -> p.copy(position = index) }
            updateMap(state.data.copy(pins = updatedPins))
        }
    }

    fun moveGroup(fromIndex: Int, toIndex: Int) {
        val state = _uiState.value
        if (state is UiState.Success) {
            val groups = state.data.groups.toMutableList()
            if (fromIndex !in groups.indices || toIndex !in groups.indices) return
            
            val group = groups.removeAt(fromIndex)
            groups.add(toIndex, group)
            
            val updatedGroups = groups.mapIndexed { index, g -> g.copy(position = index) }
            updateMap(state.data.copy(groups = updatedGroups))
        }
    }

    fun geocodePin(pinId: String) {
        val state = _uiState.value
        if (state is UiState.Success) {
            val pin = state.data.pins.find { it.id == pinId } ?: return
            if (!pin.address.isNullOrBlank()) return 
            
            viewModelScope.launch {
                val address = repository.reverseGeocode(pin.lat, pin.lng)
                if (address != null) {
                    val updatedPins = state.data.pins.map {
                        if (it.id == pinId) it.copy(address = address) else it
                    }
                    updateMap(state.data.copy(pins = updatedPins))
                }
            }
        }
    }
}

class OurMapsViewModelFactory(
    private val repository: MapRepository,
    private val context: android.content.Context
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return when {
            modelClass.isAssignableFrom(MapListViewModel::class.java) -> MapListViewModel(repository) as T
            modelClass.isAssignableFrom(MapDetailViewModel::class.java) -> MapDetailViewModel(repository, context) as T
            else -> throw IllegalArgumentException("Unknown ViewModel class")
        }
    }
}
