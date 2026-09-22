package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/RemoteActionResponse.cs.
@Serializable
data class RemoteActionResponse(
    val success: Boolean,
    val error: String? = null,
    val requestId: String? = null,
) {
    companion object {
        fun ok() = RemoteActionResponse(success = true)

        fun fail(error: String) = RemoteActionResponse(success = false, error = error)
    }
}
