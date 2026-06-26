package com.google.ourmaps.viewmodel

import com.google.ourmaps.model.MapData
import com.google.ourmaps.repository.MapRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.Mock
import org.mockito.Mockito.`when`
import org.mockito.Mockito.verify
import org.mockito.Mockito.anyString
import org.mockito.Mockito.anyInt
import org.mockito.Mockito.anySet
import org.mockito.MockitoAnnotations

@ExperimentalCoroutinesApi
class MapDetailViewModelTest {

    @Mock
    private lateinit var repository: MapRepository

    @Mock
    private lateinit var context: android.content.Context

    @Mock
    private lateinit var sharedPreferences: android.content.SharedPreferences

    private lateinit var viewModel: MapDetailViewModel
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        MockitoAnnotations.openMocks(this)
        `when`(context.getSharedPreferences(anyString(), anyInt())).thenReturn(sharedPreferences)
        `when`(sharedPreferences.getStringSet(anyString(), anySet())).thenReturn(emptySet())
        `when`(context.getString(anyInt())).thenReturn("http://localhost/api/")
        Dispatchers.setMain(testDispatcher)
        viewModel = MapDetailViewModel(repository, context)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `loadMap updates uiState to Success when repository returns map`() = runTest {
        // Arrange
        val mapId = "map1"
        val mockMap = MapData(mapId, "Test Map", "user1", "User One", "user1@test.com", emptyList(), emptyList(), "owner", null, null)
        `when`(repository.getMap(mapId)).thenReturn(Result.success(mockMap))

        // Act
        viewModel.loadMap(mapId)
        testDispatcher.scheduler.advanceUntilIdle()

        // Assert
        val currentState = viewModel.uiState.value
        assertTrue(currentState is UiState.Success)
        assertEquals(mockMap, (currentState as UiState.Success).data)
    }

    @Test
    fun `deleteMap calls repository delete and success callback`() = runTest {
        // Arrange
        val mapId = "map1"
        `when`(repository.deleteMap(mapId)).thenReturn(Result.success(Unit))
        var callbackCalled = false

        // Act
        viewModel.deleteMap(mapId) { callbackCalled = true }
        testDispatcher.scheduler.advanceUntilIdle()

        // Assert
        verify(repository).deleteMap(mapId)
        assertTrue(callbackCalled)
    }

    @Test
    fun `updateMap updates uiState to Success with new map data`() = runTest {
        // Arrange
        val mapId = "map1"
        val mockMap = MapData(mapId, "Updated Map", "user1", "User One", "user1@test.com", emptyList(), emptyList(), "owner", null, null)
        `when`(repository.updateMap(mapId, mockMap)).thenReturn(Result.success(Unit))

        // Act
        viewModel.updateMap(mockMap)
        testDispatcher.scheduler.advanceUntilIdle()

        // Assert
        val currentState = viewModel.uiState.value
        assertTrue(currentState is UiState.Success)
        assertEquals(mockMap, (currentState as UiState.Success).data)
    }
}
