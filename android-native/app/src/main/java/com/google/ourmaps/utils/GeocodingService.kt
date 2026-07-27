package com.google.ourmaps.utils

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.google.ourmaps.repository.MapRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import java.net.URLEncoder

data class SearchResult(
    val name: String,
    val description: String,
    val location: GeoPoint
)

data class ServerSearchResult(
    val place_id: String,
    val display_name: String,
    val lat: String,
    val lon: String
)

data class ServerGeocodeResponse(
    val address: String?
)

object GeocodingService {
    private val client = OkHttpClient()
    private val gson = Gson()
    private const val USER_AGENT = "OurMapsAndroidApp/1.0"

    suspend fun search(
        context: Context, 
        query: String, 
        biasBbox: BoundingBox? = null
    ): List<SearchResult> = withContext(Dispatchers.IO) {
        try {
            val baseUrl = context.getString(com.google.ourmaps.R.string.api_base_url)
            val encodedQuery = URLEncoder.encode(query, "UTF-8")
            var url = "${baseUrl}places/search?q=$encodedQuery"
            
            if (biasBbox != null) {
                // bounds=west,north,east,south
                val viewbox = "${biasBbox.lonWest},${biasBbox.latNorth},${biasBbox.lonEast},${biasBbox.latSouth}"
                url += "&bounds=$viewbox"
            }

            val token = MapRepository.idToken ?: run {
                // Fallback base64 mock token for testing/dev environments
                val mockUser = "{\"id\":\"test-user-id-places\",\"email\":\"places@example.com\",\"name\":\"Places User\",\"picture\":\"\"}"
                android.util.Base64.encodeToString(mockUser.toByteArray(), android.util.Base64.NO_WRAP)
            }

            val request = Request.Builder()
                .url(url)
                .header("User-Agent", USER_AGENT)
                .header("Authorization", "Bearer $token")
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext emptyList()
            
            val type = object : TypeToken<List<ServerSearchResult>>() {}.type
            val results: List<ServerSearchResult> = gson.fromJson(body, type)

            results.map { res ->
                SearchResult(
                    name = res.display_name.split(",")[0],
                    description = res.display_name,
                    location = GeoPoint(res.lat.toDouble(), res.lon.toDouble())
                )
            }
        } catch (e: Exception) {
            Log.e("GeocodingService", "Google places search proxy failed", e)
            emptyList()
        }
    }

    suspend fun reverseGeocode(
        context: Context,
        lat: Double,
        lng: Double
    ): String? = withContext(Dispatchers.IO) {
        try {
            val baseUrl = context.getString(com.google.ourmaps.R.string.api_base_url)
            val url = "${baseUrl}places/reverse-geocode?lat=$lat&lng=$lng"

            val token = MapRepository.idToken ?: run {
                val mockUser = "{\"id\":\"test-user-id-places\",\"email\":\"places@example.com\",\"name\":\"Places User\",\"picture\":\"\"}"
                android.util.Base64.encodeToString(mockUser.toByteArray(), android.util.Base64.NO_WRAP)
            }

            val request = Request.Builder()
                .url(url)
                .header("User-Agent", USER_AGENT)
                .header("Authorization", "Bearer $token")
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext null
            
            val result: ServerGeocodeResponse = gson.fromJson(body, ServerGeocodeResponse::class.java)
            result.address
        } catch (e: Exception) {
            Log.e("GeocodingService", "Google reverse geocode proxy failed", e)
            null
        }
    }
}
