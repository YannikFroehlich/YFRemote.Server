package com.yfremote.android.server

import io.ktor.websocket.CloseReason
import io.ktor.websocket.close
import io.ktor.server.websocket.DefaultWebSocketServerSession

// Android-Aequivalent zu WebSockets/WebSocketConnectionRegistry.cs: erlaubt es, offene /ws-
// Verbindungen eines Geraets gezielt zu schliessen (z.B. beim Entkoppeln in der Setup-UI).
class ConnectionRegistry {
    private val lock = Any()
    private val connectionsByDeviceId = mutableMapOf<String, MutableList<DefaultWebSocketServerSession>>()

    fun register(deviceId: String, session: DefaultWebSocketServerSession): AutoCloseable {
        synchronized(lock) {
            connectionsByDeviceId.getOrPut(deviceId) { mutableListOf() }.add(session)
        }
        return AutoCloseable {
            synchronized(lock) {
                connectionsByDeviceId[deviceId]?.let { sessions ->
                    sessions.remove(session)
                    if (sessions.isEmpty()) connectionsByDeviceId.remove(deviceId)
                }
            }
        }
    }

    suspend fun closeConnections(deviceId: String) {
        val sessions = synchronized(lock) { connectionsByDeviceId[deviceId]?.toList() } ?: return
        sessions.forEach { session ->
            runCatching { session.close(CloseReason(CloseReason.Codes.NORMAL, "Device unpaired.")) }
        }
    }
}
