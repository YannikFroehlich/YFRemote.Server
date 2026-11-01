package com.yfremote.android.server.models

import kotlinx.serialization.Serializable

// Antwort von GET /launch/apps wie { apps } in LaunchEndpoints.cs.
@Serializable
data class LaunchAppsResponse(val apps: List<String>)
