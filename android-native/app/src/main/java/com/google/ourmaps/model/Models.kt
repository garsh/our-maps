package com.google.ourmaps.model

data class User(
    val id: String,
    val email: String,
    val name: String,
    val picture: String?
)

data class Pin(
    val id: String,
    val lat: Double,
    val lng: Double,
    val label: String?,
    val description: String?,
    val imageUrl: String?,
    val color: String?,
    val icon: String?,
    val groupId: String?,
    val position: Int
)

data class PinGroup(
    val id: String,
    val name: String,
    val position: Int
)

data class MapData(
    val id: String,
    val name: String,
    val ownerId: String,
    val ownerName: String?,
    val ownerEmail: String?,
    val groups: List<PinGroup>,
    val pins: List<Pin>,
    val userRole: String?, // 'owner' | 'edit' | 'view'
    val lastAccessedAt: String?
)
