package com.yfremote.android.remote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Ein Geraet, das dieses Telefon steuert - `url` ist die Basis-URL seines YFRemote-Servers. */
data class RemoteDevice(val url: String, val name: String)

// Nur die Liste der Adressen: das Pairing-Token liegt im localStorage des WebViews, pro Origin,
// genau wie im Browser - der Web-Client verwaltet es selbst.
class RemoteDevices(context: Context) {

    private val prefs = context.getSharedPreferences("remote_devices", Context.MODE_PRIVATE)

    fun load(): List<RemoteDevice> = parse(prefs.getString(KEY, null))

    fun add(device: RemoteDevice) = save(load().filterNot { it.url == device.url } + device)

    fun remove(url: String) = save(load().filterNot { it.url == url })

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

        fun parse(json: String?): List<RemoteDevice> = try {
            val array = JSONArray(json ?: "[]")
            (0 until array.length()).map {
                val item = array.getJSONObject(it)
                RemoteDevice(item.getString("url"), item.getString("name"))
            }
        } catch (e: Exception) {
            emptyList()
        }

        fun serialize(devices: List<RemoteDevice>): String = JSONArray(
            devices.map { JSONObject().put("url", it.url).put("name", it.name) },
        ).toString()
    }
}
