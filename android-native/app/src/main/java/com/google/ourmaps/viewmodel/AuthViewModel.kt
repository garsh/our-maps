package com.google.ourmaps.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.tasks.Task
import com.google.gson.Gson
import com.google.ourmaps.model.User
import com.google.ourmaps.repository.MapRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class AuthViewModel : ViewModel() {

    private val _user = MutableStateFlow<User?>(null)
    val user: StateFlow<User?> = _user.asStateFlow()
    private val gson = Gson()

    fun checkExistingLogin(context: Context, repository: MapRepository) {
        val prefs = context.getSharedPreferences("our_maps_auth", Context.MODE_PRIVATE)
        val savedToken = prefs.getString("custom_jwt", null)
        val savedUserJson = prefs.getString("user_json", null)
        
        if (savedToken != null && savedUserJson != null) {
            try {
                val savedUser = gson.fromJson(savedUserJson, User::class.java)
                _user.value = savedUser
                MapRepository.idToken = savedToken
                MapRepository.userJson = savedUserJson
                return
            } catch (e: Exception) {
                // Parse failed, fall through to Google Sign In
            }
        }
        
        val account = GoogleSignIn.getLastSignedInAccount(context)
        if (account != null) {
            val googleIdToken = account.idToken
            if (googleIdToken != null) {
                viewModelScope.launch {
                    val result = repository.googleLogin(googleIdToken)
                    if (result.isSuccess) {
                        val response = result.getOrNull()
                        if (response != null) {
                            _user.value = response.user
                        }
                    } else {
                        updateUser(account)
                    }
                }
            } else {
                updateUser(account)
            }
        }
    }

    fun handleSignInResult(task: Task<GoogleSignInAccount>, repository: MapRepository) {
        try {
            val account = task.getResult(ApiException::class.java)
            val googleIdToken = account.idToken
            if (googleIdToken != null) {
                viewModelScope.launch {
                    val result = repository.googleLogin(googleIdToken)
                    if (result.isSuccess) {
                        val response = result.getOrNull()
                        if (response != null) {
                            _user.value = response.user
                        }
                    } else {
                        updateUser(account)
                    }
                }
            } else {
                updateUser(account)
            }
        } catch (e: ApiException) {
            _user.value = null
            MapRepository.userJson = null
            MapRepository.idToken = null
        }
    }

    private fun updateUser(account: GoogleSignInAccount) {
        val user = User(
            id = account.id ?: "",
            email = account.email ?: "",
            name = account.displayName ?: "",
            picture = account.photoUrl?.toString()
        )
        _user.value = user
        MapRepository.idToken = account.idToken
        MapRepository.userJson = gson.toJson(user)
    }

    fun logout(context: Context, client: GoogleSignInClient) {
        client.signOut().addOnCompleteListener {
            _user.value = null
            MapRepository.userJson = null
            MapRepository.idToken = null
            val prefs = context.getSharedPreferences("our_maps_auth", Context.MODE_PRIVATE)
            prefs.edit().clear().apply()
        }
    }

    // Deprecated mock login
    fun loginMock() {
        if (com.google.ourmaps.BuildConfig.DEBUG) {
            viewModelScope.launch {
                val user = User(
                    id = "mock-user-id",
                    email = "mock@example.com",
                    name = "Mock User",
                    picture = null
                )
                _user.value = user
                MapRepository.idToken = null // Force fallback if needed
                MapRepository.userJson = gson.toJson(user)
            }
        }
    }
}
