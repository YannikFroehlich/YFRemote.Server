package com.yfremote.android.remote

import android.content.Context
import java.net.URI
import java.net.URISyntaxException
import org.json.JSONArray
import org.json.JSONObject

/** Ein Geraet, das dieses Telefon steuert - `url` ist die Basis-URL seines YFRemote-Servers,
 *  `mac` die zuletzt per /health gemeldete MAC fuer Wake-on-LAN, `macWireless` ob sie WLAN ist. */
data class RemoteDevice(
    val url: String,
    val name: String,
    val mac: String? = null,
    val macWireless: Boolean = false,
)

// Nur die Liste der Adressen: das Pairing-Token liegt im localStorage des WebViews, pro Origin,
// genau wie im Browser - der Web-Client verwaltet es selbst.
class RemoteDevices(context: Context) {

    private val prefs = context.getSharedPreferences("remote_devices", Context.MODE_PRIVATE)

    fun load(): List<RemoteDevice> = parse(prefs.getString(KEY, null))

    fun add(device: RemoteDevice) = save(load().filterNot { it.url == device.url } + device)

    fun remove(url: String) = save(load().filterNot { it.url == url })

    fun setMac(url: String, mac: String, wireless: Boolean) =
        save(load().map { if (it.url == url) it.copy(mac = mac, macWireless = wireless) else it })

    private fun save(devices: List<RemoteDevice>) {
        prefs.edit().putString(KEY, serialize(devices)).apply()
    }

    companion object {
        private const val KEY = "devices"
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
         * vom Freigeben-Bereich) -> Adresse und, falls enthalten, PIN. Sonst null.
         */
        fun parseQrCode(text: String): Pair<String, String?>? {
            val uri = try {
                URI(text.trim())
            } catch (e: URISyntaxException) {
                return null
            }
            val host = uri.host ?: return null
            val port = when (uri.scheme?.lowercase()) {
                "http" -> if (uri.port == -1) 80 else uri.port
                // ponytail: HTTPS-QR (Tray mit "HTTPS verwenden") -> HTTP auf dem Standardport, weil
                // das WebView der lokalen CA nicht vertraut; ein geaenderter Server:Port geht hier verloren.
                "https" -> DEFAULT_PORT
                else -> return null
            }
            val url = normalizeAddress("$host:$port") ?: return null
            val pin = Regex("(?:^|&)pin=(\\d{6})(?:&|$)").find(uri.rawFragment.orEmpty())?.groupValues?.get(1)
            return url to pin
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
                )
            }
        } catch (e: Exception) {
            emptyList()
        }

        fun serialize(devices: List<RemoteDevice>): String = JSONArray(
            devices.map {
                JSONObject().put("url", it.url).put("name", it.name).putOpt("mac", it.mac)
                    .put("macWireless", it.macWireless)
            },
        ).toString()
    }
}
