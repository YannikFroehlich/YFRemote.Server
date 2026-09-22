package com.yfremote.android.server

import android.content.Context
import com.yfremote.android.server.models.ClipboardResponse
import com.yfremote.android.server.models.ClipboardTextRequest
import com.yfremote.android.server.models.FileUploadResponse
import com.yfremote.android.server.models.HealthResponse
import com.yfremote.android.server.models.PairRequest
import com.yfremote.android.server.models.PairResponse
import com.yfremote.android.server.models.PairStatusResponse
import com.yfremote.android.server.models.RemoteActionRequest
import com.yfremote.android.server.models.RemoteActionResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.PartData
import io.ktor.http.content.forEachPart
import io.ktor.http.defaultForFilePath
import io.ktor.utils.io.core.readBytes
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.request.path
import io.ktor.server.request.receive
import io.ktor.server.request.receiveMultipart
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import java.io.IOException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

// Bewusst als eine Datei fuer alle Endpunkte, wie Program.cs' MapGet/MapPost-Kette - ein
// RemoteActionRouter/eine PairingRepository-Instanz pro Prozess, keine eigene Klasse pro Route.
fun Route.installRoutes(
    context: Context,
    pairing: PairingRepository,
    router: RemoteActionRouter,
    connectionRegistry: ConnectionRegistry,
    fileTransferBridge: FileTransferBridge,
    clipboardBridge: ClipboardBridge,
    clipboardOptions: ClipboardOptions,
    fileTransferOptions: FileTransferOptions,
    json: Json,
) {
    get("/health") { call.respond(HealthResponse("ok", "YFRemote.Android")) }

    webSocket("/ws") {
        if (!call.isAllowedOrigin()) {
            close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, "Origin not allowed."))
            return@webSocket
        }

        val token = call.request.queryParameters["token"]
        val deviceId = pairing.validateToken(token)
        if (deviceId == null) {
            close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, "Pairing required."))
            return@webSocket
        }

        // Ein gepairtes Geraet gilt bereits als vertrauenswuerdig; das Limit schuetzt nur vor
        // einer durchgehenden Flut (siehe YFRemoteWebSocketHandler.cs).
        val rateLimiter = FixedWindowRateLimiter(limit = 120, windowMillis = 1000)
        val registration = connectionRegistry.register(deviceId, this)

        try {
            for (frame in incoming) {
                if (frame !is Frame.Text) continue

                val response = if (!rateLimiter.tryAcquire()) {
                    RemoteActionResponse.fail("Rate limit exceeded.")
                } else {
                    handleActionMessage(frame.readText(), router, json)
                }

                send(Frame.Text(json.encodeToString(RemoteActionResponse.serializer(), response)))
            }
        } finally {
            registration.close()
        }
    }

    post("/pair") {
        if (!call.isAllowedOrigin()) {
            call.respondText("Origin not allowed.", status = HttpStatusCode.Forbidden)
            return@post
        }

        val request = try {
            call.receive<PairRequest>()
        } catch (e: Exception) {
            call.respond(PairResponse.fail("Invalid JSON."))
            return@post
        }

        call.respond(pairing.tryPair(request.pin, request.deviceName, call.clientIp()))
    }

    get("/pair/status") {
        // Keine Origin-Pruefung: ein Same-Origin-GET-fetch() sendet ueblicherweise keinen
        // Origin-Header, und der Endpoint liefert ohnehin nur ein Ja/Nein zu einem Token, das
        // der Aufrufer bereits kennen muss (siehe Program.cs).
        val token = call.request.queryParameters["token"]
        call.respond(PairStatusResponse(pairing.isValidToken(token)))
    }

    delete("/pair") {
        if (!call.isAllowedOrigin()) {
            call.respondText("Origin not allowed.", status = HttpStatusCode.Forbidden)
            return@delete
        }

        when (val result = pairing.removeDeviceByToken(call.bearerToken())) {
            is PairingRepository.RemovalResult.Removed -> {
                connectionRegistry.closeConnections(result.deviceId)
                call.respond(HttpStatusCode.NoContent)
            }

            PairingRepository.RemovalResult.NotFound -> call.respond(HttpStatusCode.Unauthorized)

            PairingRepository.RemovalResult.PersistenceFailed -> call.respond(
                HttpStatusCode.InternalServerError,
                PairResponse.fail("Entkopplung konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen."),
            )
        }
    }

    post("/files") {
        if (!call.isAllowedOrigin()) {
            call.respondText("Origin not allowed.", status = HttpStatusCode.Forbidden)
            return@post
        }
        if (pairing.validateToken(call.bearerToken()) == null) {
            call.respond(HttpStatusCode.Unauthorized)
            return@post
        }

        val contentLength = call.contentLengthOrNull()
        if (contentLength != null && contentLength > fileTransferOptions.maxFileSizeBytes) {
            call.respond(HttpStatusCode.PayloadTooLarge, FileUploadResponse.fail("File is too large."))
            return@post
        }

        var savedFileName: String? = null
        var tooLarge = false
        var sawFile = false

        call.receiveMultipart().forEachPart { part ->
            if (part is PartData.FileItem && savedFileName == null) {
                sawFile = true
                fileTransferBridge.saveFile(part.originalFileName ?: "Datei", part.provider())
                    .onSuccess { savedFileName = it }
                    .onFailure { error -> if (error is FileTooLargeException) tooLarge = true }
            }
            part.dispose()
        }

        when {
            tooLarge -> call.respond(HttpStatusCode.PayloadTooLarge, FileUploadResponse.fail("File is too large."))
            !sawFile || savedFileName == null -> call.respond(HttpStatusCode.BadRequest, FileUploadResponse.fail("No file was sent."))
            else -> call.respond(FileUploadResponse.ok(savedFileName!!))
        }
    }

    route("/clipboard") {
        post("/text") {
            if (!call.isAllowedOrigin()) {
                call.respondText("Origin not allowed.", status = HttpStatusCode.Forbidden)
                return@post
            }
            if (pairing.validateToken(call.bearerToken()) == null) {
                call.respond(HttpStatusCode.Unauthorized)
                return@post
            }

            val request = try {
                call.receive<ClipboardTextRequest>()
            } catch (e: Exception) {
                call.respond(ClipboardResponse.fail("Invalid JSON."))
                return@post
            }

            val text = request.text
            if (text.isNullOrEmpty()) {
                call.respond(HttpStatusCode.BadRequest, ClipboardResponse.fail("Text must not be empty."))
                return@post
            }
            if (text.length > clipboardOptions.maxTextLength) {
                call.respond(HttpStatusCode.BadRequest, ClipboardResponse.fail("Text must be at most ${clipboardOptions.maxTextLength} characters."))
                return@post
            }

            try {
                clipboardBridge.setText(text)
                call.respond(ClipboardResponse.ok())
            } catch (e: SecurityException) {
                call.respond(
                    HttpStatusCode.InternalServerError,
                    ClipboardResponse.fail("Zwischenablage-Zugriff verweigert - Android erlaubt das nur der fokussierten App oder aktiven Tastatur."),
                )
            }
        }

        post("/image") {
            if (!call.isAllowedOrigin()) {
                call.respondText("Origin not allowed.", status = HttpStatusCode.Forbidden)
                return@post
            }
            if (pairing.validateToken(call.bearerToken()) == null) {
                call.respond(HttpStatusCode.Unauthorized)
                return@post
            }

            val contentLength = call.contentLengthOrNull()
            if (contentLength != null && contentLength > clipboardOptions.maxImageSizeBytes) {
                call.respond(HttpStatusCode.PayloadTooLarge, ClipboardResponse.fail("Image is too large."))
                return@post
            }

            var bytes: ByteArray? = null
            call.receiveMultipart().forEachPart { part ->
                if (part is PartData.FileItem && bytes == null) {
                    bytes = part.provider().readBytes()
                }
                part.dispose()
            }

            val imageBytes = bytes
            if (imageBytes == null || imageBytes.isEmpty()) {
                call.respond(HttpStatusCode.BadRequest, ClipboardResponse.fail("No image was sent."))
                return@post
            }
            if (imageBytes.size > clipboardOptions.maxImageSizeBytes) {
                call.respond(HttpStatusCode.PayloadTooLarge, ClipboardResponse.fail("Image is too large."))
                return@post
            }

            clipboardBridge.setImage(imageBytes).fold(
                onSuccess = { call.respond(ClipboardResponse.ok()) },
                onFailure = {
                    call.respond(
                        HttpStatusCode.InternalServerError,
                        ClipboardResponse.fail("Zwischenablage-Zugriff verweigert - Android erlaubt das nur der fokussierten App oder aktiven Tastatur."),
                    )
                },
            )
        }
    }

    // SPA-Fallback wie app.MapFallbackToFile("index.html") in Program.cs - faengt jeden sonst
    // unbehandelten GET ab und liefert aus den APK-Assets statt einem echten Dateisystempfad
    // (client/dist wird in assets/www hineinkopiert, siehe app/build.gradle.kts).
    get("/{...}") { serveWebClientAsset(call, context) }
}

private suspend fun handleActionMessage(text: String, router: RemoteActionRouter, json: Json): RemoteActionResponse {
    return try {
        val request = json.decodeFromString(RemoteActionRequest.serializer(), text)
        router.handle(request)
    } catch (e: SerializationException) {
        RemoteActionResponse.fail("Invalid JSON.")
    }
}

private fun ApplicationCall.contentLengthOrNull(): Long? =
    request.headers["Content-Length"]?.toLongOrNull()

private suspend fun serveWebClientAsset(call: ApplicationCall, context: Context) {
    val requestPath = call.request.path().trimStart('/').ifEmpty { "index.html" }
    val assets = context.assets

    // Servierter Pfad kann vom angefragten abweichen (SPA-Fallback) - Content-Type muss zum
    // tatsaechlich gesendeten Pfad passen, sonst zeigt der Browser bei z.B. "/settings" einen
    // Download-Dialog statt index.html zu rendern (defaultForFilePath faellt sonst auf
    // octet-stream zurueck).
    var servedPath = requestPath
    var bytes = readAsset(assets, "www/$requestPath")
    if (bytes == null) {
        servedPath = "index.html"
        bytes = readAsset(assets, "www/index.html")
    }

    if (bytes == null) {
        call.respond(HttpStatusCode.NotFound)
        return
    }

    call.respondBytes(bytes, ContentType.defaultForFilePath(servedPath))
}

private fun readAsset(assets: android.content.res.AssetManager, path: String): ByteArray? = try {
    assets.open(path).use { it.readBytes() }
} catch (e: IOException) {
    null
}
