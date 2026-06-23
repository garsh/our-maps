package com.google.ourmaps.api

import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.Query

interface GeocodingApi {
    @Headers("User-Agent: OurMaps/1.0 (Android Native)")
    @GET("reverse")
    suspend fun reverseGeocode(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("format") format: String = "jsonv2"
    ): NominatimResponse
}

data class NominatimResponse(
    val display_name: String?
)
