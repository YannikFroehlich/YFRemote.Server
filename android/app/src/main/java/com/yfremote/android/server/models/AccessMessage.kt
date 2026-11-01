package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/AccessMessage.cs: kommt bei jedem Verbinden zuerst. Keine Defaults, weil der
// Server-Json mit encodeDefaults = false sie sonst weglassen wuerde.
@Serializable
data class AccessMessage(
    val type: String,
    val mediaOnly: Boolean,
)
