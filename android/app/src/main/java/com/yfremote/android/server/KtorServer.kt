package com.yfremote.android.server

import android.content.Context
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.netty.NettyApplicationEngine
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import kotlinx.serialization.json.Json

// Android-Aequivalent zum Web-Host-Aufbau in Program.cs (siehe PLAN.md, Stufe 1): Ktor mit
// Netty-Engine statt Kestrel, sonst dieselbe Rolle - ein Prozess, ein Port, dieselben Endpunkte.
class KtorServer(
    private val context: Context,
    private val port: Int,
    private val pairing: PairingRepository,
    private val router: RemoteActionRouter,
    private val connectionRegistry: ConnectionRegistry,
    private val fileTransferBridge: FileTransferBridge,
    private val clipboardBridge: ClipboardBridge,
    private val clipboardOptions: ClipboardOptions,
    private val fileTransferOptions: FileTransferOptions,
) {
    companion object {
        const val DEFAULT_PORT = 5050

        // Aequivalent zu YFRemoteWebSocketHandler.cs' MaxMessageBytes. Ktors WebSockets-Plugin
        // setzt das direkt am Frame durch (Verbindung schliesst bei Ueberschreitung), statt wie
        // im .NET-Server eine Fail-Antwort zu senden und die Verbindung offenzuhalten -
        // ponytail: bewusste Vereinfachung ueber die Bibliothek statt eigener Puffer-Logik.
        const val MAX_MESSAGE_BYTES = 16 * 1024
    }

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
    }

    private var engine: NettyApplicationEngine? = null

    fun start() {
        if (engine != null) return

        engine = embeddedServer(Netty, port = port, host = "0.0.0.0") {
            install(ContentNegotiation) { json(json) }
            install(WebSockets) { maxFrameSize = MAX_MESSAGE_BYTES.toLong() }

            routing {
                installRoutes(
                    context = context,
                    pairing = pairing,
                    router = router,
                    connectionRegistry = connectionRegistry,
                    fileTransferBridge = fileTransferBridge,
                    clipboardBridge = clipboardBridge,
                    clipboardOptions = clipboardOptions,
                    fileTransferOptions = fileTransferOptions,
                    json = json,
                )
            }
        }.also { it.start(wait = false) }
    }

    fun stop() {
        engine?.stop(gracePeriodMillis = 200, timeoutMillis = 1000)
        engine = null
    }
}
