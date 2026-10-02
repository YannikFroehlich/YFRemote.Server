package com.yfremote.android.remote

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface

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

    // Blockiert kurz (Netzwerk) - nicht auf dem UI-Thread aufrufen. Neben 255.255.255.255 auch an
    // die Broadcast-Adresse jedes Netzes: manche Router leiten den allgemeinen Broadcast nicht
    // weiter, und Android schickt ihn nicht zwingend ueber das WLAN.
    fun send(mac: String): Boolean {
        val payload = packet(mac) ?: return false
        val targets = NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.interfaceAddresses.asSequence() }
            .mapNotNull { it.broadcast }
            .plus(InetAddress.getByName("255.255.255.255"))
            .distinct()
            .toList()

        DatagramSocket().use { socket ->
            socket.broadcast = true
            for (target in targets) {
                runCatching { socket.send(DatagramPacket(payload, payload.size, target, PORT)) }
            }
        }
        return true
    }
}
