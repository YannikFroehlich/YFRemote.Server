package com.yfremote.android.remote

import android.content.Context
import java.net.URI
import java.net.URISyntaxException
import org.json.JSONArray
import org.json.JSONObject

/** Ein Geraet, das dieses Telefon steuert - `url` ist die Basis-URL seines YFRemote-Servers,
 *  `mac` die zuletzt per /health gemeldete MAC fuer Wake-on-LAN, `macWireless` ob sie WLAN ist,
 *  `ca` bei HTTPS die geprueft geladene lokale CA des PCs (DER, Base64, siehe PinnedCa).
 *  `named`: der Nutzer hat den Namen selbst vergeben; sonst uebernimmt die App den per /health
 *  gemeldeten Geraetenamen. */
data class RemoteDevice(
    val url: String,
    val name: String,
    val mac: String? = null,
    val macWireless: Boolean = false,
    val ca: String? = null,
    val named: Boolean = false,
) {
    /** "192.168.0.5:5050" - nur noch Nebeninfo unter dem Namen. */
    val address: String get() = url.substringAfter("://")
    val secure: Boolean get() = url.startsWith("https://")
}

/** Inhalt eines YFRemote-QR-Codes; `caSha256` nur bei HTTPS mit Fingerabdruck der CA, `httpPort` dort,
 *  wo der PC diese CA ausliefert. */
data class QrCode(val url: String, val pin: String?, val caSha256: String? = null, val httpPort: Int = RemoteDevices.DEFAULT_PORT)

// Die Liste der Adressen. Das Pairing-Token verwaltet der Web-Client im localStorage des WebViews,
// pro Origin wie im Browser; RemoteWebActivity liest eine Kopie davon aus (setToken), damit Teilen und
// das Medien-Widget ohne geoeffnete Oberflaeche zum Geraet sprechen koennen.
class RemoteDevices(private val context: Context) {

    private val prefs = context.getSharedPreferences("remote_devices", Context.MODE_PRIVATE)
    private val tokens = context.getSharedPreferences("remote_tokens", Context.MODE_PRIVATE)

    fun load(): List<RemoteDevice> = parse(prefs.getString(KEY, null))

    fun add(device: RemoteDevice) = save(load().filterNot { it.url == device.url } + device)

    fun remove(url: String) {
        save(load().filterNot { it.url == url })
        tokens.edit().remove(url).apply()
        if (lastUrl == url) prefs.edit().remove(KEY_LAST).apply()
        MediaWidget.refresh(context)
    }

    fun token(url: String): String? = tokens.getString(url, null)

    /** null: im Web-Client nicht gemerkt oder entkoppelt - dann kann nur die Oberflaeche selbst koppeln. */
    fun setToken(url: String, token: String?) {
        if (token == null) tokens.edit().remove(url).apply() else tokens.edit().putString(url, token).apply()
    }

    /** Zuletzt geoeffnetes Geraet - das Ziel des Medien-Widgets. */
    val lastUrl: String? get() = prefs.getString(KEY_LAST, null)

    fun setLast(url: String) {
        prefs.edit().putString(KEY_LAST, url).apply()
        MediaWidget.refresh(context)
    }

    fun last(): RemoteDevice? = lastUrl?.let { url -> load().firstOrNull { it.url == url } }

    fun setMac(url: String, mac: String, wireless: Boolean) =
        save(load().map { if (it.url == url) it.copy(mac = mac, macWireless = wireless) else it })

    /** Vom Geraet gemeldeter Name - ersetzt nur einen Namen, den der Nutzer nicht selbst vergeben hat. */
    fun setReportedName(url: String, name: String) =
        save(load().map { if (it.url == url && !it.named) it.copy(name = name) else it })

    /** Leerer Name: wieder automatisch, bis /health den Geraetenamen liefert gilt die Adresse. */
    fun rename(url: String, name: String) = save(
        load().map {
            if (it.url != url) it else if (name.isBlank()) it.copy(name = it.address, named = false) else it.copy(name = name.trim(), named = true)
        },
    )

    private fun save(devices: List<RemoteDevice>) {
        prefs.edit().putString(KEY, serialize(devices)).apply()
        // Das Widget zeigt Namen und Ziel des zuletzt geoeffneten Geraets.
        MediaWidget.refresh(context)
    }

    companion object {
        private const val KEY = "devices"
        private const val KEY_LAST = "last"
        const val DEFAULT_PORT = 5050

        /** "192.168.0.5", "pc.local:5060" oder "http://..." -> "http://host:port", sonst null. */
        fun normalizeAddress(input: String): String? {
            val address = input.trim().removePrefix("http://").trimEnd('/')
            if (address.isEmpty() || address.contains("://") || address.contains('/')) return null

            val host = address.substringBefore(':')
            val port = if (address.contains(':')) address.substringAfter(':').toIntOrNull() else DEFAULT_PORT
            if (host.isEmpty() || host.any { it.isWhitespace() } || port == null || port !in 1..65535) {
                return null
            }

            return "http://$host:$port"
        }

        /**
         * Inhalt eines YFRemote-QR-Codes ("http://192.168.0.5:5050/#pin=123456", vom Tray oder
         * vom Freigeben-Bereich) -> Adresse, falls enthalten PIN und bei HTTPS der CA-Fingerabdruck.
         * Sonst null.
         */
        fun parseQrCode(text: String): QrCode? {
            val uri = try {
                URI(text.trim())
            } catch (e: URISyntaxException) {
                return null
            }
            val host = uri.host ?: return null
            val fragment = uri.rawFragment.orEmpty()
            val pin = Regex("(?:^|&)pin=(\\d{6})(?:&|$)").find(fragment)?.groupValues?.get(1)
            val caSha256 = Regex("(?:^|&)ca=([0-9a-f]{64})(?:&|$)").find(fragment)?.groupValues?.get(1)
            val httpPort = Regex("(?:^|&)http=(\\d{1,5})(?:&|$)").find(fragment)?.groupValues?.get(1)?.toInt()
                ?.takeIf { it in 1..65535 } ?: DEFAULT_PORT
            return when (uri.scheme?.lowercase()) {
                "http" -> normalizeAddress("$host:${if (uri.port == -1) 80 else uri.port}")?.let { QrCode(it, pin) }
                // Ohne Fingerabdruck (aelterer PC) kein HTTPS: HTTP auf dem Standardport, denn der QR-Code
                // eines solchen PCs nennt seinen HTTP-Port nicht.
                "https" -> if (caSha256 == null) {
                    normalizeAddress("$host:$DEFAULT_PORT")?.let { QrCode(it, pin) }
                } else {
                    normalizeAddress("$host:${if (uri.port == -1) 443 else uri.port}")
                        ?.let { QrCode(it.replaceFirst("http://", "https://"), pin, caSha256, httpPort) }
                }
                else -> null
            }
        }

        fun parse(json: String?): List<RemoteDevice> = try {
            val array = JSONArray(json ?: "[]")
            (0 until array.length()).map {
                val item = array.getJSONObject(it)
                RemoteDevice(
                    item.getString("url"),
                    item.getString("name"),
                    item.optString("mac").ifEmpty { null },
                    item.optBoolean("macWireless"),
                    item.optString("ca").ifEmpty { null },
                    // Aeltere Eintraege ohne das Feld: ein Name ungleich der Adresse war selbst vergeben.
                    if (item.has("named")) {
                        item.getBoolean("named")
                    } else {
                        item.getString("name") != item.getString("url").substringAfter("://")
                    },
                )
            }
        } catch (e: Exception) {
            emptyList()
        }

        fun serialize(devices: List<RemoteDevice>): String = JSONArray(
            devices.map {
                JSONObject().put("url", it.url).put("name", it.name).putOpt("mac", it.mac)
                    .put("macWireless", it.macWireless).putOpt("ca", it.ca).put("named", it.named)
            },
        ).toString()
    }
}
