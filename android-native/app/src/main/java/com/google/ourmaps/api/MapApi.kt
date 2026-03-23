package com.google.ourmaps.api

import com.google.ourmaps.model.MapData
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface MapApi {
    @GET("maps")
    suspend fun getMaps(): List<MapData>

    @GET("maps/{id}")
    suspend fun getMap(@Path("id") id: String): MapData

    @POST("maps")
    suspend fun createMap(@Body mapData: MapData): MapData
}
