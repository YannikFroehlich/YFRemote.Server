package com.yfremote.android.remote

import android.content.Context

/** Welcher eigene Button hinter einem Widget ("widget:<id>") oder einer Schnellkachel ("tile:<n>")
 *  liegt. Gemerkt wird nur Geraet und Button-Id; die Schritte kommen beim Tippen frisch aus
 *  RemoteDevices.buttons, damit eine Aenderung im Web-Client auch hier gilt. */
class ButtonTargets(private val context: Context) {

    data class Target(val url: String, val buttonId: String)

    /** Aufgeloestes Ziel: Geraet, Button und Token, oder null, wenn eines davon fehlt. */
    data class Resolved(val device: RemoteDevice, val button: RemoteButton, val token: String?)

    private val prefs = context.getSharedPreferences("button_targets", Context.MODE_PRIVATE)

    fun get(key: String): Target? {
        val value = prefs.getString(key, null) ?: return null
        return Target(value.substringBefore('\n'), value.substringAfter('\n'))
    }

    fun set(key: String, target: Target) = prefs.edit().putString(key, "${target.url}\n${target.buttonId}").apply()

    fun remove(key: String) = prefs.edit().remove(key).apply()

    fun resolve(key: String): Resolved? {
        val target = get(key) ?: return null
        val devices = RemoteDevices(context)
        val device = devices.load().firstOrNull { it.url == target.url } ?: return null
        val button = devices.buttons(target.url).firstOrNull { it.id == target.buttonId } ?: return null
        return Resolved(device, button, devices.token(target.url))
    }

    companion object {
        fun widgetKey(id: Int) = "widget:$id"
        fun tileKey(slot: Int) = "tile:$slot"
    }
}
