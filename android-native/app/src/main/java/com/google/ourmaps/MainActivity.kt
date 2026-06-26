package com.google.ourmaps

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import coil.compose.AsyncImage
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.ourmaps.model.MapData
import com.google.ourmaps.ui.MapDetailScreen
import com.google.ourmaps.ui.theme.DarkSlateBlue
import com.google.ourmaps.ui.theme.LightGray
import com.google.ourmaps.ui.theme.OurMapsTheme
import com.google.ourmaps.ui.theme.SuccessGreen
import com.google.ourmaps.utils.KmlHelper
import com.google.ourmaps.utils.NotificationHelper
import com.google.ourmaps.utils.OfflineManager
import com.google.ourmaps.repository.MapRepository
import com.google.ourmaps.viewmodel.*
import org.osmdroid.config.Configuration
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val osmdroidConfig = Configuration.getInstance()
        osmdroidConfig.load(this, getSharedPreferences("osmdroid", MODE_PRIVATE))
        osmdroidConfig.userAgentValue = packageName
        
        // Performance optimizations for downloads
        osmdroidConfig.tileDownloadThreads = 8
        osmdroidConfig.tileDownloadMaxQueueSize = 100
        
        NotificationHelper.createNotificationChannel(this)
        
        val repository = MapRepository.getInstance(this)
        val factory = OurMapsViewModelFactory(repository, this)

        setContent {
            OurMapsTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    App(factory = factory, repository = repository)
                }
            }
        }
    }
}

@Composable
fun App(authViewModel: AuthViewModel = viewModel(), factory: OurMapsViewModelFactory, repository: MapRepository) {
    val navController = rememberNavController()
    val user by authViewModel.user.collectAsState()
    val context = LocalContext.current

    val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
        .requestIdToken(context.getString(R.string.google_client_id))
        .requestEmail()
        .build()
    val googleSignInClient = GoogleSignIn.getClient(context, gso)

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
        authViewModel.handleSignInResult(task, repository)
    }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { }

    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { }

    LaunchedEffect(Unit) {
        repository.setOnUnauthorizedCallback {
            authViewModel.logout(context, googleSignInClient)
        }
        
        authViewModel.checkExistingLogin(context, repository)
        
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }

        locationPermissionLauncher.launch(arrayOf(
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.ACCESS_COARSE_LOCATION
        ))
    }

    if (user == null) {
        LoginScreen(onLoginClick = {
            launcher.launch(googleSignInClient.signInIntent)
        })
    } else {
        NavHost(navController = navController, startDestination = "mapList") {
            composable("mapList") {
                val mapListViewModel: MapListViewModel = viewModel(factory = factory)
                MapListScreen(
                    viewModel = mapListViewModel,
                    onMapClick = { mapId -> navController.navigate("mapDetail/$mapId") },
                    onLogout = { authViewModel.logout(context, googleSignInClient) },
                    userPicture = user?.picture,
                    userName = user?.name
                )
            }
            composable("mapDetail/{mapId}") { backStackEntry ->
                val mapId = backStackEntry.arguments?.getString("mapId") ?: return@composable
                android.util.Log.d("OURMAPS_DEBUG", "MainActivity: Navigating to mapDetail/$mapId")
                val mapDetailViewModel: MapDetailViewModel = viewModel(factory = factory)
                MapDetailScreen(
                    mapId = mapId,
                    viewModel = mapDetailViewModel,
                    onBack = { navController.popBackStack() }
                )
            }
        }
    }
}

@Composable
fun LoginScreen(onLoginClick: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.Default.Place,
            contentDescription = "Map Logo",
            tint = DarkSlateBlue,
            modifier = Modifier.size(64.dp)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text("Our Maps", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = DarkSlateBlue)
        Spacer(modifier = Modifier.height(8.dp))
        Text("Create and share sets of location pins", style = MaterialTheme.typography.bodyLarge, color = Color.Gray)
        Spacer(modifier = Modifier.height(48.dp))
        Button(
            onClick = onLoginClick,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Sign in with Google", fontSize = 16.sp)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapListScreen(
    viewModel: MapListViewModel,
    onMapClick: (String) -> Unit,
    onLogout: () -> Unit,
    userPicture: String?,
    userName: String?
) {
    val uiState by viewModel.uiState.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    var showCreateDialog by remember { mutableStateOf(false) }
    var newMapName by remember { mutableStateOf("") }
    var mapToDelete by remember { mutableStateOf<MapData?>(null) }
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        viewModel.fetchMaps()
    }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri?.let {
            try {
                val inputStream = context.contentResolver.openInputStream(it)
                inputStream?.use { stream ->
                    val newMapId = java.util.UUID.randomUUID().toString()
                    val mapData = KmlHelper.parseKmlToMapData(stream, newMapId, "me")
                    viewModel.importMap(mapData) { mapId ->
                        onMapClick(mapId)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    if (showCreateDialog) {
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text("Create New Map") },
            text = {
                OutlinedTextField(
                    value = newMapName,
                    onValueChange = { newMapName = it },
                    label = { Text("Map Name") },
                    singleLine = true
                )
            },
            confirmButton = {
                Button(onClick = {
                    if (newMapName.isNotBlank()) {
                        viewModel.createMap(newMapName) { mapId ->
                            showCreateDialog = false
                            onMapClick(mapId)
                        }
                    }
                }) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (mapToDelete != null) {
        AlertDialog(
            onDismissRequest = { mapToDelete = null },
            title = { Text("Delete Map?") },
            text = { Text("Are you sure you want to delete '${mapToDelete?.name}'? This action cannot be undone.") },
            confirmButton = {
                Button(
                    onClick = {
                        mapToDelete?.let { map ->
                            viewModel.deleteMap(map.id) {
                                OfflineManager.removeOfflineMap(context, map.id)
                                mapToDelete = null
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { mapToDelete = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { 
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                        Icon(Icons.Default.Place, contentDescription = null, modifier = Modifier.size(24.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Our Maps", fontWeight = FontWeight.Bold)
                            if (uiState is UiState.Success && (uiState as UiState.Success).data.any { it.ownerId == "offline" }) {
                                Text("Offline Mode", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.7f))
                            }
                        }
                    }
                },
                actions = {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 8.dp)) {
                        AsyncImage(
                            model = userPicture,
                            contentDescription = "User Avatar",
                            modifier = Modifier.size(32.dp).clip(CircleShape)
                        )
                        IconButton(onClick = onLogout) {
                            Icon(Icons.Default.ExitToApp, contentDescription = "Logout")
                        }
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = DarkSlateBlue,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        },
        floatingActionButton = {
            var showFabMenu by remember { mutableStateOf(false) }
            
            Box {
                FloatingActionButton(
                    onClick = { showFabMenu = !showFabMenu },
                    containerColor = SuccessGreen,
                    contentColor = Color.White
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Add Menu")
                }
                
                DropdownMenu(
                    expanded = showFabMenu,
                    onDismissRequest = { showFabMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Create New Map") },
                        onClick = {
                            showFabMenu = false
                            newMapName = ""
                            showCreateDialog = true
                        },
                        leadingIcon = { Icon(Icons.Default.Add, contentDescription = null) }
                    )
                    DropdownMenuItem(
                        text = { Text("Import KML") },
                        onClick = {
                            showFabMenu = false
                            importLauncher.launch(arrayOf("application/vnd.google-earth.kml+xml", "text/xml", "application/xml"))
                        },
                        leadingIcon = { Icon(Icons.Default.Place, contentDescription = null) }
                    )
                }
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize().background(LightGray)) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth().padding(16.dp).background(Color.White, RoundedCornerShape(8.dp)),
                placeholder = { Text("Search maps...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                shape = RoundedCornerShape(8.dp),
                singleLine = true
            )

            Text(
                "Your Maps",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            Box(modifier = Modifier.weight(1f)) {
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
                        val filteredMaps = state.data.filter { 
                            it.name.contains(searchQuery, ignoreCase = true) ||
                            (it.ownerName ?: "").contains(searchQuery, ignoreCase = true)
                        }

                        if (filteredMaps.isEmpty()) {
                            Column(modifier = Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Default.Place, contentDescription = null, modifier = Modifier.size(64.dp), tint = Color.LightGray)
                                Spacer(modifier = Modifier.height(16.dp))
                                Text("No maps found.", color = Color.Gray)
                            }
                        } else {
                            LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 80.dp)) {
                                items(filteredMaps) { map ->
                                    MapListItem(
                                        map = map, 
                                        onClick = onMapClick,
                                        onDeleteClick = { mapToDelete = it }
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

@Composable
fun MapListItem(map: MapData, onClick: (String) -> Unit, onDeleteClick: (MapData) -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clickable { onClick(map.id) },
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(8.dp)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = map.name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = DarkSlateBlue,
                    modifier = Modifier.weight(1f)
                )
                
                if (map.ownerId == "me" || map.userRole == "owner") {
                    IconButton(onClick = { onDeleteClick(map) }) {
                        Icon(Icons.Default.Delete, contentDescription = "Delete Map", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
                    }
                }
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = if (map.ownerId == "me") "Owner" else "Shared by ${map.ownerName ?: "Unknown"}",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.Gray
            )
            Spacer(modifier = Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = Color.LightGray
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "Accessed ${formatDate(map.lastAccessedAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.LightGray
                )
            }
        }
    }
}

private fun formatDate(dateString: String?): String {
    if (dateString == null) return "Never"
    return try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        val date = sdf.parse(dateString) ?: return "Never"
        SimpleDateFormat("MMM d, yyyy", Locale.getDefault()).format(date)
    } catch (e: Exception) {
        dateString
    }
}
