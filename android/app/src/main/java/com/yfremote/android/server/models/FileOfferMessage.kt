package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/FileOfferMessage.cs. "type" ohne Default, weil der Server-Json mit
// encodeDefaults = false Felder mit Default-Wert weglassen wuerde.
@Serializable
data class FileOfferMessage(
    val type: String,
    val id: String,
    val name: String,
    val size: Long,
)
