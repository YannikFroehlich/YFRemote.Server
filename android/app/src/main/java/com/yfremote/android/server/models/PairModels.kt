package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/PairRequest.cs, PairResponse.cs, PairStatusResponse.cs, PairedDeviceInfo.cs -
// vier kleine Records in einer Datei, wie im .NET-Server je ein eigenes File.

@Serializable
data class PairRequest(
    val pin: String? = null,
    val deviceName: String? = null,
)

@Serializable
data class PairResponse(
    val success: Boolean,
    val token: String? = null,
    val error: String? = null,
) {
    companion object {
        fun ok(token: String) = PairResponse(success = true, token = token)

        fun fail(error: String) = PairResponse(success = false, error = error)
    }
}

@Serializable
data class PairStatusResponse(val valid: Boolean)

@Serializable
data class PairedDeviceInfo(
    val id: String,
    val name: String,
    val pairedAtUtc: String,
    val lastSeenUtc: String,
)
