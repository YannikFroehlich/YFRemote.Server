package com.yfremote.android.server

import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.server.websocket.DefaultWebSocketServerSession
import kotlinx.coroutines.launch

// Android-Aequivalent zu WebSockets/WebSocketConnectionRegistry.cs: erlaubt es, offene /ws-
// Verbindungen eines Geraets gezielt zu schliessen (z.B. beim Entkoppeln in der Setup-UI).
// onAllClosed laeuft, sobald die letzte Verbindung endet - auf dem Thread dieser Verbindung.
class ConnectionRegistry(private val onAllClosed: () -> Unit = {}) {
    private val lock = Any()
    private val connectionsByDeviceId = mutableMapOf<String, MutableList<DefaultWebSocketServerSession>>()
    private val mediaOnlySessions = mutableSetOf<DefaultWebSocketServerSession>()

    // mediaOnly gilt fuer die ganze Verbindung - eine Aenderung schliesst sie (siehe setMediaOnly).
    fun register(deviceId: String, session: DefaultWebSocketServerSession, mediaOnly: Boolean = false): AutoCloseable {
        synchronized(lock) {
            connectionsByDeviceId.getOrPut(deviceId) { mutableListOf() }.add(session)
            if (mediaOnly) mediaOnlySessions.add(session)
        }
        return AutoCloseable {
            val allClosed = synchronized(lock) {
                val sessions = connectionsByDeviceId[deviceId] ?: return@synchronized false
                if (!sessions.remove(session)) return@synchronized false
                mediaOnlySessions.remove(session)
                if (sessions.isEmpty()) connectionsByDeviceId.remove(deviceId)
                connectionsByDeviceId.isEmpty()
            }
            if (allClosed) onAllClosed()
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

    // Ungefragte Server-Nachricht (z.B. ein Datei-Angebot) an alle offenen Verbindungen. send()
    // geht in den Ausgangs-Channel der Session und darf deshalb parallel zur Antwortschleife laufen.
    fun broadcast(text: String, includeMediaOnly: Boolean) {
        val sessions = synchronized(lock) {
            connectionsByDeviceId.values.flatten().filter { includeMediaOnly || it !in mediaOnlySessions }
        }
        sessions.forEach { session ->
            session.launch { runCatching { session.send(Frame.Text(text)) } }
        }
    }
}
