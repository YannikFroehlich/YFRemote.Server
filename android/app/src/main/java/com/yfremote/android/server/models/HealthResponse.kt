package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Spiegelt Models/HealthResponse.cs.
@Serializable
data class HealthResponse(val status: String, val service: String, val platform: String)
