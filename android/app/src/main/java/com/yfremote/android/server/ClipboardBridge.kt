package com.yfremote.android.server

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

// Android-Aequivalent zu Services/WindowsClipboardService.cs (siehe PLAN.md, Stufe 4). Ein Bild
// braucht eine content://-URI statt eines rohen Byte-Streams wie unter Windows, daher der Umweg
// ueber eine App-private Cache-Datei + FileProvider.
class ClipboardBridge(private val context: Context) {

    private val clipboardManager =
        context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    fun setText(text: String) {
        clipboardManager.setPrimaryClip(ClipData.newPlainText("YFRemote", text))
    }

    // Seit Android 10 liest nur die App mit Fokus oder die ausgewaehlte Tastatur die
    // Zwischenablage - der Dienst im Hintergrund also nur, solange die YFRemote-Tastatur
    // ausgewaehlt ist. Sonst liefert Android stillschweigend null statt eines Fehlers.
    fun canReadText(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
                ?.startsWith("${context.packageName}/") == true

    fun getText(): String? =
        clipboardManager.primaryClip
            ?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)
            ?.coerceToText(context)
            ?.toString()

    fun setImage(bytes: ByteArray): Result<Unit> {
        return try {
            val cacheSubdir = File(context.cacheDir, "clipboard").apply { mkdirs() }
            val cacheFile = File(cacheSubdir, "${UUID.randomUUID()}.png")
            cacheFile.writeBytes(bytes)

            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", cacheFile)
            context.grantUriPermission(context.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)

            clipboardManager.setPrimaryClip(ClipData.newUri(context.contentResolver, "YFRemote-Bild", uri))
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
