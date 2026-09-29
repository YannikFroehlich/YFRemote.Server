package com.yfremote.android.server

import com.yfremote.android.server.models.FileOfferMessage
import java.io.File
import java.io.InputStream
import java.util.UUID

// Android-Gegenstueck zu Services/FileOfferService.cs: die eine Datei, die das Geraet gerade den
// gekoppelten Geraeten anbietet. Eine neue Freigabe ersetzt die alte; nach 10 Minuten laeuft sie
// ab, damit ein Geraet, das sich viel spaeter verbindet, keine vergessene Datei angeboten bekommt.
class FileOfferRepository(
    private val offersDir: File,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val LIFETIME_MILLIS = 10 * 60 * 1000L
    }

    private class ActiveOffer(val message: FileOfferMessage, val file: File, val expiresAt: Long)

    @Volatile
    private var current: ActiveOffer? = null

    @Volatile
    var onOffered: ((FileOfferMessage) -> Unit)? = null

    val currentOffer: FileOfferMessage?
        get() = active()?.message

    // Kopiert in den App-Cache statt die content://-URI zu behalten: deren Leserecht gilt nur,
    // solange die teilende Activity lebt.
    fun offer(requestedName: String, content: InputStream): FileOfferMessage {
        // Die alte Datei darf weg - ein laufender Download liest ueber seinen offenen
        // Dateideskriptor weiter.
        offersDir.deleteRecursively()
        offersDir.mkdirs()

        val file = File(offersDir, sanitizeFileName(requestedName))
        file.outputStream().use { content.copyTo(it) }

        val message = FileOfferMessage("fileOffer", UUID.randomUUID().toString(), file.name, file.length())
        current = ActiveOffer(message, file, clock() + LIFETIME_MILLIS)
        onOffered?.invoke(message)
        return message
    }

    fun fileFor(id: String): File? = active()?.takeIf { it.message.id == id }?.file

    private fun active(): ActiveOffer? = current?.takeIf { clock() < it.expiresAt }
}
