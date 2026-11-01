package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/HealthResponse.cs; name ist der Geraetename aus den Einstellungen.
@Serializable
data class HealthResponse(val status: String, val service: String, val platform: String, val name: String)
