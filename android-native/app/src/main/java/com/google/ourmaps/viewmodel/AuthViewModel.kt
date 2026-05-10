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

    fun checkExistingLogin(context: Context) {
        val account = GoogleSignIn.getLastSignedInAccount(context)
        if (account != null) {
            updateUser(account)
        }
    }

    fun handleSignInResult(task: Task<GoogleSignInAccount>) {
        try {
            val account = task.getResult(ApiException::class.java)
            updateUser(account)
        } catch (e: ApiException) {
            // Handle error
            _user.value = null
            MapRepository.userJson = null
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
