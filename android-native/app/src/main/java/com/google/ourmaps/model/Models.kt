package com.google.ourmaps.model

import com.google.gson.annotations.SerializedName

data class User(
    val id: String,
    val email: String,
    val name: String,
    val picture: String?
)

data class Pin(
    @SerializedName("id") val id: String,
    @SerializedName("lat") val lat: Double,
    @SerializedName("lng") val lng: Double,
    @SerializedName("label") val label: String? = null,
    @SerializedName("description") val description: String? = null,
    @SerializedName("address") val address: String? = null,
    @SerializedName("imageUrl") val imageUrl: String? = null,
    @SerializedName("color") val color: String? = "blue",
    @SerializedName("icon") val icon: String? = "default",
    @SerializedName("groupId") val groupId: String? = null,
    @SerializedName("position") val position: Int = 0
)

data class PinGroup(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("position") val position: Int = 0
)

data class MapPermission(
    val userId: String,
    val userEmail: String,
    val userName: String?,
    val role: String // 'owner' | 'edit' | 'view'
)

data class MapData(
    val id: String,
    val name: String,
    val ownerId: String,
    val ownerName: String?,
    val ownerEmail: String?,
    val groups: List<PinGroup>,
    val pins: List<Pin>,
    val userRole: String?, // Current user's role
    val permissions: List<MapPermission>?, // List of all users with access
    val lastAccessedAt: String?
)

data class GoogleLoginRequest(
    val credential: String
)

data class GoogleLoginResponse(
    val token: String,
    val user: User
)
