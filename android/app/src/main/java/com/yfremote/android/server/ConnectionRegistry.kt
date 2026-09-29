package com.yfremote.android.server

import io.ktor.websocket.CloseReason
import io.ktor.websocket.close
import io.ktor.server.websocket.DefaultWebSocketServerSession
import kotlinx.coroutines.launch

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

    // Nicht suspend, damit auch die Setup-UI (Main-Thread, ohne Coroutine) entkoppeln kann -
    // jede Session schliesst sich in ihrem eigenen Scope.
    fun closeConnections(deviceId: String) {
        val sessions = synchronized(lock) { connectionsByDeviceId[deviceId]?.toList() } ?: return
        sessions.forEach { session ->
            session.launch {
                runCatching { session.close(CloseReason(CloseReason.Codes.NORMAL, "Device unpaired.")) }
            }
        }
    }
}
