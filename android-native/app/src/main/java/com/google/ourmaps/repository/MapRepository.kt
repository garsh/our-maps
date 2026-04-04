package com.google.ourmaps.repository

import android.content.Context
import com.google.gson.Gson
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

    companion object {
        var userJson: String? = null
        
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
            val json = userJson ?: "{\"id\":\"mock-user-id\",\"email\":\"mock@example.com\",\"name\":\"Mock User\"}"
            val base64Token = android.util.Base64.encodeToString(json.toByteArray(), android.util.Base64.NO_WRAP)
            
            val request = chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $base64Token")
                .build()
            chain.proceed(request)
        }

        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl("http://192.168.4.146:3000/api/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        api = retrofit.create(MapApi::class.java)
    }

    suspend fun getMaps(): Result<List<MapData>> {
        return try {
            val maps = api.getMaps()
            Result.success(maps)
        } catch (e: Exception) {
            // Fallback to offline maps
            val offlineMaps = OfflineManager.getAllOfflineMaps(context)
            if (offlineMaps.isNotEmpty()) {
                Result.success(offlineMaps)
            } else {
                Result.failure(e)
            }
        }
    }

    suspend fun getMap(id: String): Result<MapData> {
        return try {
            val map = api.getMap(id)
            Result.success(map)
        } catch (e: Exception) {
            // Fallback to offline map
            val offlineMap = OfflineManager.getOfflineMap(context, id)
            if (offlineMap != null) {
                Result.success(offlineMap)
            } else {
                Result.failure(e)
            }
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
            else Result.failure(Exception("Update failed"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteMap(id: String): Result<Unit> {
        return try {
            val response = api.deleteMap(id)
            if (response.isSuccessful) Result.success(Unit)
            else Result.failure(Exception("Delete failed"))
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
