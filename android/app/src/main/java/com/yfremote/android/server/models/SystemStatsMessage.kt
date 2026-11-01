package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/SystemStatsMessage.cs plus den Akku. CPU- und GPU-Werte fehlen immer (siehe
// SystemStatsReader); fehlende Werte laesst encodeDefaults = false weg, wie null am PC.
@Serializable
data class SystemStatsMessage(
    val type: String,
    val memoryUsedMb: Long,
    val memoryTotalMb: Long,
    val batteryLevel: Int? = null,
    val batteryCharging: Boolean? = null,
    val batteryTemperature: Int? = null,
)
