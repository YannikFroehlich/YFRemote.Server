package com.yfremote.android.remote

import android.util.Base64
import java.io.IOException
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.BufferedSink
import okio.source
import org.json.JSONObject

// Spricht ohne WebView mit einem gesteuerten Geraet, mit dem Pairing-Token, das RemoteWebActivity
// aus dem Web-Client uebernommen hat - fuer "Teilen" (ShareActivity) und das Medien-Widget. Dieselben
// Endpunkte wie der Web-Client, daher auch derselbe Origin-Header (RequestGuards.IsAllowedOrigin).
internal class RemoteClient(private val device: RemoteDevice, private val token: String) {

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .apply {
            device.ca?.let { encoded ->
                val ca = PinnedCa.parse(Base64.decode(encoded, Base64.DEFAULT))
                sslSocketFactory(PinnedCa.sslContext(ca).socketFactory, PinnedCa.trustManager(ca))
            }
        }
        .build()

    /** POST /files - liest den Stream erst beim Senden, eine grosse Datei liegt nie ganz im Speicher. */
    fun uploadFile(name: String, mimeType: String?, open: () -> InputStream?): Result {
        val body = object : RequestBody() {
            override fun contentType(): MediaType? = mimeType?.toMediaTypeOrNull()

            override fun writeTo(sink: BufferedSink) {
                (open() ?: throw IOException("unreadable")).source().use { sink.writeAll(it) }
            }
        }
        val form = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("file", name, body).build()
        return post("/files", form)
    }

    /** POST /clipboard/text - Text in die Zwischenablage des Geraets. */
    fun clipboardText(text: String): Result =
        post("/clipboard/text", JSONObject().put("text", text).toString().toRequestBody(JSON))

    /**
     * Eine Aktion ueber /ws, wie ein Button im Web-Client. Wartet auf die Antwort mit derselben
     * requestId; die Meldungen, die der Server ungefragt schickt (access, media, ...), tragen keine.
     */
    fun send(action: JSONObject): Result {
        val requestId = UUID.randomUUID().toString()
        val done = CountDownLatch(1)
        var result: Result = Result.Failed(null)
        val wsUrl = device.url.replaceFirst("http", "ws") + "/ws?token=" + java.net.URLEncoder.encode(token, "UTF-8")
        val request = Request.Builder().url(wsUrl).header("Origin", device.url).build()
        val socket = http.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(JSONObject(action.toString()).put("requestId", requestId).toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                    if (message.optString("requestId") != requestId) return
                    val error = message.optString("error").ifEmpty { null }
                    result = when {
                        message.optBoolean("success") -> Result.Ok
                        error == MEDIA_ONLY_ERROR -> Result.MediaOnly
                        else -> Result.Failed(error)
                    }
                    done.countDown()
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    result = response?.let { failure(it.code, null) } ?: Result.Unreachable
                    done.countDown()
                }
            },
        )
        if (!done.await(6, TimeUnit.SECONDS)) result = Result.Unreachable
        socket.close(1000, null)
        return result
    }

    private fun post(path: String, body: RequestBody): Result {
        val request = Request.Builder()
            .url(device.url + path)
            .header("Authorization", "Bearer $token")
            .header("Origin", device.url)
            .post(body)
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                if (response.isSuccessful) Result.Ok else failure(response.code, response.body?.string())
            }
        } catch (e: IOException) {
            Result.Unreachable
        }
    }

    sealed class Result {
        data object Ok : Result()
        data object Unreachable : Result()
        data object NotPaired : Result()
        data object MediaOnly : Result()
        data object TooLarge : Result()
        data class Failed(val error: String?) : Result()

        /** Hinweis fuer einen Toast, null bei Erfolg. */
        fun message(deviceName: String): String? = when (this) {
            Ok -> null
            Unreachable -> "$deviceName ist nicht erreichbar."
            NotPaired -> "Nicht mehr mit $deviceName gekoppelt - bitte in der App neu koppeln."
            MediaOnly -> "$deviceName erlaubt diesem Gerät nur Medien."
            TooLarge -> "Die Datei ist für $deviceName zu groß."
            is Failed -> "$deviceName hat abgelehnt" + (error?.let { ": $it" } ?: ".")
        }
    }

    internal companion object {
        private val JSON = "application/json".toMediaTypeOrNull()

        // RemoteActionHandler.MediaOnlyError - dieselbe Ablehnung bei /ws und den Bearer-Endpunkten.
        private const val MEDIA_ONLY_ERROR = "Not allowed for this device."

        /** Statuscode einer abgelehnten Anfrage -> Ergebnis; der Text von 403 unterscheidet "Nur Medien". */
        fun failure(code: Int, body: String?): Result = when {
            code == 401 -> Result.NotPaired
            code == 413 -> Result.TooLarge
            code == 403 && body?.contains(MEDIA_ONLY_ERROR) == true -> Result.MediaOnly
            else -> Result.Failed(body?.let { runCatching { JSONObject(it).optString("error") }.getOrNull() }?.ifEmpty { null })
        }
    }
}
