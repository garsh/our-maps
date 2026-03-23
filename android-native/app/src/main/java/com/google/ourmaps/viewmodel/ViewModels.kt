package com.google.ourmaps.viewmodel

import androidx.lifecycle.ViewModel
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

class MapListViewModel(private val repository: MapRepository = MapRepository()) : ViewModel() {

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
                _uiState.value = UiState.Success(maps)
            }.onFailure { e ->
                _uiState.value = UiState.Error(e.message ?: "Unknown error")
            }
        }
    }
}

class MapDetailViewModel(private val repository: MapRepository = MapRepository()) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<MapData>>(UiState.Loading)
    val uiState: StateFlow<UiState<MapData>> = _uiState.asStateFlow()

    fun loadMap(id: String) {
        viewModelScope.launch {
            _uiState.value = UiState.Loading
            val result = repository.getMap(id)
            result.onSuccess { map ->
                _uiState.value = UiState.Success(map)
            }.onFailure { e ->
                _uiState.value = UiState.Error(e.message ?: "Unknown error")
            }
        }
    }
}
