package com.google.ourmaps.api

import retrofit2.http.GET
import retrofit2.http.Query

interface GeocodingApi {
    @GET("places/reverse-geocode")
    suspend fun reverseGeocode(
        @Query("lat") lat: Double,
        @Query("lng") lng: Double
    ): GeocodeResponse
}

data class GeocodeResponse(
    val address: String?
)
