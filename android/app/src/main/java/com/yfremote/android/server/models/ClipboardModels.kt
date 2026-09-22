package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/ClipboardTextRequest.cs, ClipboardResponse.cs.

@Serializable
data class ClipboardTextRequest(val text: String? = null)

@Serializable
data class ClipboardResponse(
    val success: Boolean,
    val error: String? = null,
) {
    companion object {
        fun ok() = ClipboardResponse(success = true)

        fun fail(error: String) = ClipboardResponse(success = false, error = error)
    }
}
