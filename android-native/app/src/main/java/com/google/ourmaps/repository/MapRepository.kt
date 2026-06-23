package com.google.ourmaps.repository

import android.content.Context
import com.google.gson.Gson
import com.google.ourmaps.api.GeocodingApi
import com.google.ourmaps.api.MapApi
import com.google.ourmaps.model.MapData
import com.google.ourmaps.utils.OfflineManager
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class MapRepository(private val context: Context) {

    private val api: MapApi
    private val geocodingApi: GeocodingApi
    private var onUnauthorized: (() -> Unit)? = null

    fun setOnUnauthorizedCallback(callback: () -> Unit) {
        this.onUnauthorized = callback
    }

    companion object {
        var userJson: String? = null
        var idToken: String? = null
        
        @Volatile
        private var INSTANCE: MapRepository? = null
        fun getInstance(context: Context): MapRepository {
            return INSTANCE ?: synchronized(this) {
                val instance = MapRepository(context.applicationContext)
                INSTANCE = instance
                instance
            }
        }
    }

    init {
        val authInterceptor = Interceptor { chain ->
            // Use the real Google ID Token if we have one
            val token = idToken ?: run {
                // Fallback to base64 mock token for development
                val json = userJson ?: "{\"id\":\"mock-user-id\",\"email\":\"mock@example.com\",\"name\":\"Mock User\"}"
                android.util.Base64.encodeToString(json.toByteArray(), android.util.Base64.NO_WRAP)
            }
            
            val request = chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .addHeader("Accept", "application/json, image/webp, image/*;q=0.8")
                .build()
            
            val response = chain.proceed(request)
            
            // If the server rejects our token, clear it and notify the UI
            if (response.code == 401) {
                idToken = null
                userJson = null
                onUnauthorized?.invoke()
            }
            
            response
        }

        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(context.getString(com.google.ourmaps.R.string.api_base_url))
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        api = retrofit.create(MapApi::class.java)

        val nominatimRetrofit = Retrofit.Builder()
            .baseUrl("https://nominatim.openstreetmap.org/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
        
        geocodingApi = nominatimRetrofit.create(GeocodingApi::class.java)
    }

    suspend fun reverseGeocode(lat: Double, lng: Double): String? {
        return try {
            val response = geocodingApi.reverseGeocode(lat, lng)
            response.display_name
        } catch (e: Exception) {
            null
        }
    }

    suspend fun getMaps(): Result<List<MapData>> {
        return try {
            val maps = api.getMaps()
            Result.success(maps)
        } catch (e: java.io.IOException) {
            // ONLY fallback to offline for network errors
            val offlineMaps = OfflineManager.getAllOfflineMaps(context)
            if (offlineMaps.isNotEmpty()) {
                Result.success(offlineMaps)
            } else {
                Result.failure(e)
            }
        } catch (e: Exception) {
            // Propagate auth/server errors immediately
            Result.failure(e)
        }
    }

    suspend fun getMap(id: String): Result<MapData> {
        android.util.Log.d("OURMAPS_DEBUG", "Repository: getMap($id)")
        return try {
            val map = api.getMap(id)
            android.util.Log.d("OURMAPS_DEBUG", "Repository: getMap($id) API success")
            Result.success(map)
        } catch (e: java.io.IOException) {
            android.util.Log.w("OURMAPS_DEBUG", "Repository: getMap($id) Network Error, falling back to offline", e)
            // ONLY fallback to offline for network errors
            val offlineMap = OfflineManager.getOfflineMap(context, id)
            if (offlineMap != null) {
                android.util.Log.d("OURMAPS_DEBUG", "Repository: getMap($id) offline data found")
                Result.success(offlineMap)
            } else {
                android.util.Log.e("OURMAPS_DEBUG", "Repository: getMap($id) no offline data found")
                Result.failure(e)
            }
        } catch (e: Exception) {
            android.util.Log.e("OURMAPS_DEBUG", "Repository: getMap($id) general failure", e)
            // Propagate auth/server errors immediately
            Result.failure(e)
        }
    }

    suspend fun createMap(mapData: MapData): Result<MapData> {
        return try {
            val map = api.createMap(mapData)
            Result.success(map)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateMap(id: String, mapData: MapData): Result<Unit> {
        return try {
            val response = api.updateMap(id, mapData)
            if (response.isSuccessful) Result.success(Unit)
            else Result.failure(Exception("Update failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteMap(id: String): Result<Unit> {
        return try {
            val response = api.deleteMap(id)
            if (response.isSuccessful) Result.success(Unit)
            else Result.failure(Exception("Delete failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun shareMap(id: String, email: String, role: String): Result<Unit> {
        return try {
            val response = api.shareMap(id, mapOf("email" to email, "role" to role))
            if (response.isSuccessful) Result.success(Unit)
            else Result.failure(Exception("Share failed: ${response.code()}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun removeShare(id: String, userId: String): Result<Unit> {
        return try {
            val response = api.removeShare(id, userId)
            if (response.isSuccessful) Result.success(Unit)
            else Result.failure(Exception("Remove share failed"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
