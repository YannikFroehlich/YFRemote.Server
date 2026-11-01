package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/MediaStatusMessage.cs, bisher nur die Lautstaerke: ohne title zeigt der Client
// nur den Regler. Keine Defaults, weil der Server-Json mit encodeDefaults = false sie weglassen wuerde.
@Serializable
data class MediaStatusMessage(
    val type: String,
    val volume: Int,
    val muted: Boolean,
    val playing: Boolean,
)
