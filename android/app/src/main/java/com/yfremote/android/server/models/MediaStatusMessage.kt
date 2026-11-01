package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/MediaStatusMessage.cs. Pflichtfelder ohne Default, weil der Server-Json mit
// encodeDefaults = false sie sonst weglassen wuerde; die optionalen fehlen so ohne Wert, wie am PC.
@Serializable
data class MediaStatusMessage(
    val type: String,
    val volume: Int,
    val muted: Boolean,
    val playing: Boolean,
    val title: String? = null,
    val artist: String? = null,
    val position: Int? = null,
    val duration: Int? = null,
    val canSeek: Boolean = false,
    val coverId: String? = null,
)
