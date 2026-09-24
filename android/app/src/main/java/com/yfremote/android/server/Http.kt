package com.yfremote.android.server

import io.ktor.http.HttpHeaders
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.origin

// WebSocket-Handshakes und schreibende HTTP-Endpunkte unterliegen nicht der Same-Origin-Policy
// des Browsers - der Origin-Header muss deshalb selbst geprueft werden. Direkte Spiegelung von
// RequestGuards.IsAllowedOrigin (Endpoints/RequestGuards.cs): reiner String-Vergleich Scheme+Host-Header gegen Origin-Header,
// keine feste Allowlist.
fun ApplicationCall.isAllowedOrigin(): Boolean {
    val origin = request.headers[HttpHeaders.Origin]
    val hostHeader = request.headers[HttpHeaders.Host]
    if (origin.isNullOrEmpty() || hostHeader.isNullOrEmpty()) return false

    val expected = "${request.origin.scheme}://$hostHeader"
    return origin.equals(expected, ignoreCase = true)
}

fun ApplicationCall.bearerToken(): String? {
    val header = request.headers[HttpHeaders.Authorization] ?: return null
    val prefix = "Bearer "
    if (!header.startsWith(prefix, ignoreCase = true)) return null
    val token = header.substring(prefix.length).trim()
    return token.ifEmpty { null }
}

fun ApplicationCall.clientIp(): String = request.origin.remoteHost

// Ein Zaehler pro Verbindung genuegt (siehe YFRemoteWebSocketHandler.cs): eine WebSocket-
// Verbindung verarbeitet ihre Nachrichten ohnehin seriell.
class FixedWindowRateLimiter(private val limit: Int, private val windowMillis: Long) {
    private var windowStart = System.currentTimeMillis()
    private var messagesInWindow = 0

    fun tryAcquire(): Boolean {
        val now = System.currentTimeMillis()
        if (now - windowStart >= windowMillis) {
            windowStart = now
            messagesInWindow = 0
        }
        messagesInWindow++
        return messagesInWindow <= limit
    }
}
