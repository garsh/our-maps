package com.google.ourmaps.repository

import com.google.gson.Gson
import com.google.ourmaps.api.MapApi
import com.google.ourmaps.model.MapData
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class MapRepository {

    private val api: MapApi

    companion object {
        var userJson: String? = null
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
            Result.failure(e)
        }
    }

    suspend fun getMap(id: String): Result<MapData> {
        return try {
            val map = api.getMap(id)
            Result.success(map)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
