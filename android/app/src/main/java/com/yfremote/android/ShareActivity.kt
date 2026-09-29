package com.yfremote.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.core.content.IntentCompat
import com.yfremote.android.service.YFRemoteForegroundService
import kotlin.concurrent.thread

// Ziel von "Teilen" in anderen Apps: bietet die geteilte Datei den gekoppelten Geraeten an - das
// Gegenstueck zu "Datei an Geräte senden..." im Windows-Tray. Ohne eigene Oberflaeche, nur Toasts.
class ShareActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val service = YFRemoteForegroundService.instance
        val uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)

        when {
            service == null -> finishWith("YFRemote-Dienst läuft nicht - bitte zuerst in der App starten.")
            uri == null -> finishWith("Nur Dateien können geteilt werden.")
            else -> {
                val name = displayName(uri) ?: "Datei"
                // Kopieren im Hintergrund - eine grosse Datei wuerde den Main-Thread sonst blockieren.
                // Das Leserecht an der URI gilt, solange diese Activity lebt, daher finish() erst danach.
                thread {
                    val message = try {
                        contentResolver.openInputStream(uri)?.use { service.fileOffers.offer(name, it) }
                            ?.let { "\"${it.name}\" kann jetzt 10 Minuten lang auf den gekoppelten Geräten geladen werden." }
                            ?: "Datei konnte nicht geöffnet werden."
                    } catch (e: Exception) {
                        "Datei konnte nicht angeboten werden."
                    }
                    runOnUiThread { finishWith(message) }
                }
            }
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
}
