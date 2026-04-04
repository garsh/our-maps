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

    @retrofit2.http.PUT("maps/{id}")
    suspend fun updateMap(@Path("id") id: String, @Body mapData: MapData): retrofit2.Response<Unit>

    @retrofit2.http.DELETE("maps/{id}")
    suspend fun deleteMap(@Path("id") id: String): retrofit2.Response<Unit>

    @POST("maps/{id}/share")
    suspend fun shareMap(
        @Path("id") id: String,
        @Body shareData: Map<String, String>
    ): retrofit2.Response<Unit>

    @retrofit2.http.DELETE("maps/{id}/share/{userId}")
    suspend fun removeShare(
        @Path("id") id: String,
        @Path("userId") userId: String
    ): retrofit2.Response<Unit>
}
