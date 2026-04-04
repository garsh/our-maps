package com.google.ourmaps.utils

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
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

data class NominatimResult(
    val display_name: String,
    val lat: String,
    val lon: String,
    val type: String,
    val importance: Double
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
            val encodedQuery = URLEncoder.encode(query, "UTF-8")
            var url = "https://nominatim.openstreetmap.org/search?q=$encodedQuery&format=json&addressdetails=1&limit=10"
            
            if (biasBbox != null) {
                // viewbox=left,top,right,bottom
                val viewbox = "${biasBbox.lonWest},${biasBbox.latNorth},${biasBbox.lonEast},${biasBbox.latSouth}"
                url += "&viewbox=$viewbox&bounded=0" // bounded=0 means bias, bounded=1 means strictly inside
            }

            val request = Request.Builder()
                .url(url)
                .header("User-Agent", USER_AGENT)
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return@withContext emptyList()
            
            val type = object : TypeToken<List<NominatimResult>>() {}.type
            val results: List<NominatimResult> = gson.fromJson(body, type)

            results.map { res ->
                SearchResult(
                    name = res.display_name.split(",")[0],
                    description = res.display_name,
                    location = GeoPoint(res.lat.toDouble(), res.lon.toDouble())
                )
            }
        } catch (e: Exception) {
            Log.e("GeocodingService", "Nominatim search failed", e)
            emptyList()
        }
    }
}
