package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/RemoteActionRequest.cs Feld fuer Feld - camelCase passt ohne @SerialName.
@Serializable
data class RemoteActionRequest(
    val requestId: String? = null,
    val type: String? = null,
    val keys: List<String>? = null,
    val text: String? = null,
    val deltaX: Int? = null,
    val deltaY: Int? = null,
    val button: String? = null,
    val delta: Int? = null,
)
