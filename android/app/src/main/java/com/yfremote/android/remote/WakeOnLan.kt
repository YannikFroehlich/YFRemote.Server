package com.yfremote.android.remote

import java.net.DatagramPacket
import java.net.DatagramSocket

/** Weckt einen PC per Magic Packet. Die MAC liefert sein /health, solange er noch laeuft. */
object WakeOnLan {
    private const val PORT = 9

    /** 6 x 0xFF, dann 16 x die MAC ("AA:BB:CC:DD:EE:FF" oder mit "-"); null bei ungueltiger MAC. */
    fun packet(mac: String): ByteArray? {
        if (!MAC.matches(mac)) return null
        val bytes = mac.split(':', '-').map { it.toInt(16).toByte() }
        return ByteArray(6) { 0xFF.toByte() } + List(16) { bytes }.flatten().toByteArray()
    }

    private val MAC = Regex("[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}")

    // Blockiert kurz (Netzwerk) - nicht auf dem UI-Thread aufrufen.
    fun send(mac: String): Boolean {
        val payload = packet(mac) ?: return false
        val targets = Discovery.broadcastTargets()

        DatagramSocket().use { socket ->
            socket.broadcast = true
            for (target in targets) {
                runCatching { socket.send(DatagramPacket(payload, payload.size, target, PORT)) }
            }
        }
        return true
    }
}
