package com.yfremote.android.remote

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.SocketException
import java.net.SocketTimeoutException
import kotlin.concurrent.thread

/** Findet YFRemote-Geraete im LAN per UDP-Broadcast - dasselbe Protokoll wie NetworkDiscovery.cs im
 *  PC-Server: Anfrage ist der feste Text, Antwort nur der HTTP-Port. Name und Plattform liefert
 *  danach das ohnehin offene /health. */
object Discovery {
    const val PORT = 5050
    private const val SERVICE = "YFRemote"
    private val REQUEST = "YFREMOTE_DISCOVER_1".toByteArray(Charsets.UTF_8)
    private val SERVICE_FIELD = Regex(""""service"\s*:\s*"$SERVICE"""")
    private val PORT_FIELD = Regex(""""port"\s*:\s*(\d{1,5})""")

    fun reply(httpPort: Int): ByteArray = """{"service":"$SERVICE","port":$httpPort}""".toByteArray(Charsets.UTF_8)

    /** HTTP-Port aus einer Antwort, null wenn sie nicht von YFRemote stammt. */
    fun parseReply(text: String): Int? =
        if (!SERVICE_FIELD.containsMatchIn(text)) null
        else PORT_FIELD.find(text)?.groupValues?.get(1)?.toInt()?.takeIf { it in 1..65535 }

    /** 255.255.255.255 plus die Broadcast-Adresse jedes Netzes: manche Router leiten den allgemeinen
     *  Broadcast nicht weiter, und Android schickt ihn nicht zwingend ueber das WLAN. */
    fun broadcastTargets(): List<InetAddress> = NetworkInterface.getNetworkInterfaces().asSequence()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.interfaceAddresses.asSequence() }
        .mapNotNull { it.broadcast }
        .plus(InetAddress.getByName("255.255.255.255"))
        .distinct()
        .toList()

    /** Blockiert durationMs lang - nicht auf dem UI-Thread aufrufen. Liefert "http://ip:port" aller
     *  Geraete, die antworten, ohne dieses Geraet selbst (dessen Server antwortet ja auch). */
    fun search(durationMs: Long = 1500): List<String> {
        val own = NetworkInterface.getNetworkInterfaces().asSequence()
            .flatMap { it.inetAddresses.asSequence() }
            .toSet()
        val found = LinkedHashMap<String, String>()
        DatagramSocket().use { socket ->
            socket.broadcast = true
            for (target in broadcastTargets()) {
                runCatching { socket.send(DatagramPacket(REQUEST, REQUEST.size, target, PORT)) }
            }

            val deadline = System.currentTimeMillis() + durationMs
            val buffer = ByteArray(512)
            while (true) {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining <= 0) break
                socket.soTimeout = remaining.toInt()
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (e: SocketTimeoutException) {
                    break
                }

                val address = packet.address
                if (address !is Inet4Address || address in own) continue
                val port = parseReply(String(packet.data, 0, packet.length, Charsets.UTF_8)) ?: continue
                val host = address.hostAddress ?: continue
                found[host] = "http://$host:$port"
            }
        }
        return found.values.toList()
    }

    /** Beantwortet Suchanfragen, solange der Server laeuft (KtorServer.start/stop). */
    class Responder(private val httpPort: Int) {
        @Volatile
        private var socket: DatagramSocket? = null

        fun start() {
            if (socket != null) return
            val created = try {
                DatagramSocket(null).apply {
                    reuseAddress = true
                    bind(InetSocketAddress(PORT))
                }
            } catch (e: SocketException) {
                // Port belegt: nur die Auffindbarkeit faellt weg, manuell hinzufuegen geht weiter.
                return
            }
            socket = created

            thread(name = "yfremote-discovery", isDaemon = true) {
                val reply = reply(httpPort)
                val buffer = ByteArray(64)
                while (!created.isClosed) {
                    try {
                        val packet = DatagramPacket(buffer, buffer.size)
                        created.receive(packet)
                        if (buffer.copyOf(packet.length).contentEquals(REQUEST)) {
                            created.send(DatagramPacket(reply, reply.size, packet.address, packet.port))
                        }
                    } catch (e: Exception) {
                        // Nach stop() wirft receive - dann endet die Schleife ueber isClosed.
                    }
                }
            }
        }

        fun stop() {
            socket?.close()
            socket = null
        }
    }
}
