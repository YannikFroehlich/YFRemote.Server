package com.yfremote.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.core.content.IntentCompat
import com.yfremote.android.remote.RemoteClient
import com.yfremote.android.remote.RemoteDevice
import com.yfremote.android.remote.RemoteDevices
import com.yfremote.android.service.YFRemoteForegroundService
import kotlin.concurrent.thread
import org.json.JSONObject

// Ziel von "Teilen" in anderen Apps. Zwei Richtungen: an ein gesteuertes Geraet (PC) senden - Dateien
// per POST /files, ein Link oeffnet sich dort im Browser, anderer Text landet in der Zwischenablage -
// oder, wie "Datei an Geräte senden..." im Windows-Tray, eine Datei den mit diesem Handy gekoppelten
// Geraeten anbieten. Ohne eigene Oberflaeche, nur eine Auswahl bei mehreren Zielen und Toasts.
class ShareActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val files = when (intent.action) {
            Intent.ACTION_SEND_MULTIPLE ->
                IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
        }
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
        if (files.isEmpty() && text == null) return finishWith("Nichts zum Senden.")

        val devices = RemoteDevices(this)
        val targets = devices.load().mapNotNull { device -> devices.token(device.url)?.let { Target.Remote(device, it) } } +
            listOfNotNull(Target.Offer.takeIf { files.size == 1 })

        when (targets.size) {
            0 -> finishWith("Kein Ziel: zuerst ein Gerät in YFRemote öffnen und dort mit \"Gerät merken\" koppeln.")
            1 -> send(targets.single(), files, text)
            else -> AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Senden an")
                .setItems(targets.map { it.label }.toTypedArray()) { _, which -> send(targets[which], files, text) }
                .setOnCancelListener { finish() }
                .show()
        }
    }

    private fun send(target: Target, files: List<Uri>, text: String?) {
        // Senden im Hintergrund - eine grosse Datei wuerde den Main-Thread sonst blockieren. Das
        // Leserecht an den URIs gilt, solange diese Activity lebt, daher finish() erst danach.
        when (target) {
            Target.Offer -> thread {
                val message = offer(files.single())
                runOnUiThread { finishWith(message) }
            }
            is Target.Remote -> {
                if (files.isNotEmpty()) Toast.makeText(this, "Sende an ${target.device.name} ...", Toast.LENGTH_SHORT).show()
                thread {
                    val message = if (files.isEmpty()) sendText(target, text!!) else upload(target, files)
                    runOnUiThread { finishWith(message) }
                }
            }
        }
    }

    private fun offer(uri: Uri): String {
        val service = YFRemoteForegroundService.instance
            ?: return "YFRemote-Dienst läuft nicht - bitte zuerst in der App starten."
        return try {
            contentResolver.openInputStream(uri)?.use { service.fileOffers.offer(displayName(uri) ?: "Datei", it) }
                ?.let { "\"${it.name}\" kann jetzt 10 Minuten lang auf den gekoppelten Geräten geladen werden." }
                ?: "Datei konnte nicht geöffnet werden."
        } catch (e: Exception) {
            "Datei konnte nicht angeboten werden."
        }
    }

    private fun upload(target: Target.Remote, files: List<Uri>): String {
        val client = RemoteClient(target.device, target.token)
        files.forEach { uri ->
            val result = client.uploadFile(displayName(uri) ?: "Datei", contentResolver.getType(uri)) {
                contentResolver.openInputStream(uri)
            }
            result.message(target.device.name)?.let { return it }
        }
        return if (files.size == 1) "An ${target.device.name} gesendet." else "${files.size} Dateien an ${target.device.name} gesendet."
    }

    private fun sendText(target: Target.Remote, text: String): String {
        val client = RemoteClient(target.device, target.token)
        val url = sharedUrl(text)
        return if (url != null) {
            client.send(JSONObject().put("type", "launch").put("url", url)).message(target.device.name)
                ?: "Link auf ${target.device.name} geöffnet."
        } else {
            client.clipboardText(text).message(target.device.name)
                ?: "Text in die Zwischenablage von ${target.device.name} gelegt."
        }
    }

    private fun displayName(uri: Uri): String? =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }

    private fun finishWith(message: String) {
        Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
        finish()
    }

    private sealed class Target(val label: String) {
        class Remote(val device: RemoteDevice, val token: String) : Target(device.name)
        data object Offer : Target("Gekoppelten Geräten anbieten")
    }
}

/**
 * Geteilter Text, der nur aus einem http(s)-Link besteht (so teilen Chrome, YouTube und die meisten
 * Apps eine Seite) -> der Link, den der PC per "launch" oeffnet; sonst null. Dieselben Grenzen wie
 * HandleLaunch im Server: absolute http/https-URL, hoechstens 2000 Zeichen.
 */
internal fun sharedUrl(text: String): String? {
    val candidate = text.trim()
    if (candidate.length > 2000 || candidate.any { it.isWhitespace() }) return null
    val uri = runCatching { java.net.URI(candidate) }.getOrNull() ?: return null
    return candidate.takeIf { uri.scheme?.lowercase() in setOf("http", "https") && !uri.host.isNullOrEmpty() }
}
