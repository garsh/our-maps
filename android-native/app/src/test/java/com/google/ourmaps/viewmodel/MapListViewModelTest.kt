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
import org.mockito.MockitoAnnotations

@ExperimentalCoroutinesApi
class MapListViewModelTest {

    @Mock
    private lateinit var repository: MapRepository

    private lateinit var viewModel: MapListViewModel
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        MockitoAnnotations.openMocks(this)
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `fetchMaps updates uiState to Success when repository returns data`() = runTest {
        // Arrange
        val mockMaps = listOf(
            MapData("1", "Map 1", "user1", "User One", "user1@test.com", emptyList(), emptyList(), "owner", null)
        )
        `when`(repository.getMaps()).thenReturn(Result.success(mockMaps))

        // Act
        viewModel = MapListViewModel(repository)
        testDispatcher.scheduler.advanceUntilIdle()

        // Assert
        val currentState = viewModel.uiState.value
        assertTrue(currentState is UiState.Success)
        assertEquals(mockMaps, (currentState as UiState.Success).data)
    }

    @Test
    fun `fetchMaps updates uiState to Error when repository fails`() = runTest {
        // Arrange
        `when`(repository.getMaps()).thenReturn(Result.failure(Exception("Network error")))

        // Act
        viewModel = MapListViewModel(repository)
        testDispatcher.scheduler.advanceUntilIdle()

        // Assert
        val currentState = viewModel.uiState.value
        assertTrue(currentState is UiState.Error)
        assertEquals("Network error", (currentState as UiState.Error).message)
    }
}
