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

    fun loadMap(id: String, silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) _uiState.value = UiState.Loading
            val result = repository.getMap(id)
            result.onSuccess { map ->
                _uiState.value = UiState.Success(map)
                // Auto-sync: if this map is already downloaded, update the local metadata cache
                if (com.google.ourmaps.utils.OfflineManager.isMapDownloaded(context, id)) {
                    com.google.ourmaps.utils.OfflineManager.saveMapOffline(context, map)
                }
            }.onFailure { e ->
                if (!silent) _uiState.value = UiState.Error(e.message ?: "Unknown error")
            }
        }
    }

    fun updateMap(mapData: MapData) {
        viewModelScope.launch {
            val result = repository.updateMap(mapData.id, mapData)
            result.onSuccess {
                _uiState.value = UiState.Success(mapData)
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
                // Local cleanup is handled in the UI callback
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
                    loadMap(state.data.id, silent = true) // Refresh to show new access list
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
                    loadMap(state.data.id, silent = true) // Refresh list
                    onSuccess()
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
