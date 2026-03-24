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
import com.google.ourmaps.viewmodel.AuthViewModel
import com.google.ourmaps.viewmodel.MapListViewModel
import com.google.ourmaps.viewmodel.UiState
import org.osmdroid.config.Configuration
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Configuration.getInstance().load(this, getSharedPreferences("osmdroid", MODE_PRIVATE))
        setContent {
            OurMapsTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    App()
                }
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
                    onLogout = { authViewModel.logout(context, googleSignInClient) },
                    userPicture = user?.picture,
                    userName = user?.name
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
    viewModel: MapListViewModel = viewModel(),
    onMapClick: (String) -> Unit,
    onLogout: () -> Unit,
    userPicture: String?,
    userName: String?
) {
    val uiState by viewModel.uiState.collectAsState()
    var searchQuery by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { 
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                        Icon(Icons.Default.Place, contentDescription = null, modifier = Modifier.size(24.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Our Maps", fontWeight = FontWeight.Bold)
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
            FloatingActionButton(
                onClick = { /* TODO: Add Map */ },
                containerColor = SuccessGreen,
                contentColor = Color.White
            ) {
                Icon(Icons.Default.Add, contentDescription = "Create New Map")
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize().background(LightGray)) {
            // Search Bar inspired by web app
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
                                    MapListItem(map, onMapClick)
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
fun MapListItem(map: MapData, onClick: (String) -> Unit) {
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
            Text(text = map.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = DarkSlateBlue)
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = if (map.ownerId == "me") "Owner" else "Shared by ${map.ownerName ?: "Unknown"}",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.Gray
            )
            Spacer(modifier = Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Search, // Placeholder for Clock
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
        // Mock parser for ISO string
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        val date = sdf.parse(dateString) ?: return "Never"
        SimpleDateFormat("MMM d, yyyy", Locale.getDefault()).format(date)
    } catch (e: Exception) {
        dateString
    }
}
