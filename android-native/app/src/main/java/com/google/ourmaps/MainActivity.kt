package com.google.ourmaps

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.ourmaps.model.MapData
import com.google.ourmaps.ui.MapDetailScreen
import com.google.ourmaps.viewmodel.AuthViewModel
import com.google.ourmaps.viewmodel.MapListViewModel
import com.google.ourmaps.viewmodel.UiState
import org.osmdroid.config.Configuration

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // OSMDroid configuration
        Configuration.getInstance().load(this, getSharedPreferences("osmdroid", MODE_PRIVATE))
        
        setContent {
            MaterialTheme {
                App()
            }
        }
    }
}

@Composable
fun App(authViewModel: AuthViewModel = viewModel()) {
    val navController = rememberNavController()
    val user by authViewModel.user.collectAsState()
    val context = LocalContext.current

    val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestEmail()
        .build()
    val googleSignInClient = GoogleSignIn.getClient(context, gso)

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
        authViewModel.handleSignInResult(task)
    }

    LaunchedEffect(Unit) {
        authViewModel.checkExistingLogin(context)
    }

    if (user == null) {
        LoginScreen(onLoginClick = {
            launcher.launch(googleSignInClient.signInIntent)
        })
    } else {
        NavHost(navController = navController, startDestination = "mapList") {
            composable("mapList") {
                MapListScreen(
                    onMapClick = { mapId -> navController.navigate("mapDetail/$mapId") },
                    onLogout = { authViewModel.logout(context, googleSignInClient) }
                )
            }
            composable("mapDetail/{mapId}") { backStackEntry ->
                val mapId = backStackEntry.arguments?.getString("mapId") ?: return@composable
                MapDetailScreen(
                    mapId = mapId,
                    onBack = { navController.popBackStack() }
                )
            }
        }
    }
}

@Composable
fun LoginScreen(onLoginClick: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Welcome to Our Maps", style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(32.dp))
        Button(onClick = onLoginClick) {
            Text("Sign in with Google")
        }
    }
}

@Composable
fun MapListScreen(
    viewModel: MapListViewModel = viewModel(),
    onMapClick: (String) -> Unit,
    onLogout: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Our Maps") },
                actions = {
                    TextButton(onClick = onLogout) {
                        Text("Logout", color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { /* TODO: Add Map */ }) {
                Text("+")
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            when (val state = uiState) {
                is UiState.Loading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                is UiState.Error -> {
                    Column(modifier = Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Error: ${state.message}")
                        Button(onClick = { viewModel.fetchMaps() }) {
                            Text("Retry")
                        }
                    }
                }
                is UiState.Success -> {
                    if (state.data.isEmpty()) {
                        Text("No maps found. Create one!", modifier = Modifier.align(Alignment.Center))
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            items(state.data) { map ->
                                MapListItem(map, onMapClick)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun MapListItem(map: MapData, onClick: (String) -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp)
            .clickable { onClick(map.id) },
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = map.name, style = MaterialTheme.typography.titleMedium)
            Text(text = "Owner: ${map.ownerName ?: "Unknown"}", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TopAppBar(
    title: @Composable () -> Unit,
    actions: @Composable RowScope.() -> Unit = {}
) {
    CenterAlignedTopAppBar(
        title = title,
        actions = actions
    )
}
