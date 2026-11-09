package com.yfremote.android.media

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import com.yfremote.android.server.DeviceVolume
import com.yfremote.android.server.models.MediaStatusMessage
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// Android-Aequivalent zu WindowsMediaStatusReader: Lautstaerke von DeviceVolume, Titel, Zeitleiste und
// Cover von der aktiven MediaSession. Ohne Benachrichtigungszugriff bleibt es bei der Lautstaerke.
class MediaStatusReader(private val context: Context, private val audioManager: AudioManager) {

    companion object {
        private const val MAX_COVER_SIZE_PX = 512
        private const val MAX_COVER_BYTES = 2 * 1024 * 1024
        private const val COVER_TIMEOUT_MS = 5000
    }

    private val sessionManager = context.getSystemService(MediaSessionManager::class.java)
    private val listener = ComponentName(context, MediaAccessListener::class.java)
    private val coverLock = Any()
    private var coverKey: String? = null
    private var coverId: String? = null

    /** JPEG des aktuellen Covers fuer GET /media/cover, null ohne. */
    @Volatile
    var cover: ByteArray? = null
        private set

    fun hasAccess(): Boolean = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

    fun read(): MediaStatusMessage {
        val volume = DeviceVolume.read(audioManager)
        val controller = activeController()
        if (controller == null) {
            updateCover(null, null)
            return volume
        }

        val metadata = controller.metadata
        val state = controller.playbackState
        val playing = state?.state == PlaybackState.STATE_PLAYING
        val durationMs = metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
        // Ohne Laenge (Livestream) oder Position keine Zeitleiste, wie am PC.
        val timeline = state != null && durationMs > 0 && state.position != PlaybackState.PLAYBACK_POSITION_UNKNOWN
        val positionMs = if (state != null && timeline) {
            currentPositionMs(state.position, state.lastPositionUpdateTime, state.playbackSpeed, playing, SystemClock.elapsedRealtime())
        } else {
            0L
        }

        return volume.copy(
            title = metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)?.takeIf { it.isNotBlank() },
            artist = (metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST)
                ?: metadata?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST))?.takeIf { it.isNotBlank() },
            playing = playing,
            position = if (timeline) (positionMs.coerceIn(0L, durationMs) / 1000).toInt() else null,
            duration = if (timeline) (durationMs / 1000).toInt() else null,
            canSeek = timeline && ((state?.actions ?: 0L) and PlaybackState.ACTION_SEEK_TO) != 0L,
            coverId = updateCover(controller.packageName, metadata),
        )
    }

    // false ohne Sitzung oder wenn die App kein Spulen anbietet - wird zur Fail-Antwort.
    fun seek(seconds: Int): Boolean {
        val controller = activeController() ?: return false
        val actions = controller.playbackState?.actions ?: return false
        if ((actions and PlaybackState.ACTION_SEEK_TO) == 0L) return false
        controller.transportControls.seekTo(seconds * 1000L)
        return true
    }

    // Die spielende Sitzung vor einer pausierten; getActiveSessions liefert sie nach Prioritaet.
    private fun activeController(): MediaController? = try {
        val sessions = sessionManager.getActiveSessions(listener)
        sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: sessions.firstOrNull()
    } catch (e: SecurityException) {
        null
    }

    // Nur bei neuem Titel oder neu dazugekommenem Bild neu kodieren, nicht jede Sekunde. Die Bildgroesse
    // gehoert zum Schluessel, weil manche Apps das Cover erst nach dem Titel nachreichen.
    private fun updateCover(packageName: String?, metadata: MediaMetadata?): String? = synchronized(coverLock) {
        val bitmap = metadata?.let {
            it.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
                ?: it.getBitmap(MediaMetadata.METADATA_KEY_ART)
                ?: it.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        }
        val uri = if (bitmap == null) metadata?.let(::coverUri) else null
        val image = bitmap?.let { "${it.width}x${it.height}" } ?: uri
        val key = if (image != null && metadata != null) {
            listOf(
                packageName,
                metadata.getString(MediaMetadata.METADATA_KEY_TITLE),
                metadata.getString(MediaMetadata.METADATA_KEY_ALBUM),
                image,
            ).joinToString("|")
        } else {
            null
        }
        if (key == coverKey) return coverId

        coverKey = key
        setCover(bitmap?.let(::encodeCover))
        if (key != null && uri != null) loadCover(key, uri)
        coverId
    }

    private fun setCover(encoded: ByteArray?) {
        val bytes = encoded?.takeIf { it.size <= MAX_COVER_BYTES }
        cover = bytes
        coverId = bytes?.let { Integer.toHexString(it.contentHashCode()) }
    }

    private fun coverUri(metadata: MediaMetadata): String? = listOf(
        MediaMetadata.METADATA_KEY_ALBUM_ART_URI,
        MediaMetadata.METADATA_KEY_ART_URI,
        MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI,
    ).firstNotNullOfOrNull { key -> metadata.getString(key)?.takeIf(::isLoadableCoverUri) }

    // Neben der Abfrage, damit ein langsamer Abruf den Status nicht aufhaelt; die coverId kommt mit
    // dem naechsten Status. ponytail: ein gescheitertes Laden wird erst beim naechsten Titel wiederholt.
    private fun loadCover(key: String, uri: String) = thread(isDaemon = true) {
        val encoded = try {
            openCover(uri)?.use { readAtMost(it, MAX_COVER_BYTES) }?.let(::decodeCover)?.let(::encodeCover)
        } catch (e: Exception) {
            // Fremde content://-Adressen sind oft nicht freigegeben, dann bleibt es ohne Cover.
            null
        }
        synchronized(coverLock) {
            if (key == coverKey) setCover(encoded)
        }
    }

    private fun openCover(uri: String): InputStream? = if (uri.startsWith("http", ignoreCase = true)) {
        (URL(uri).openConnection() as HttpURLConnection).apply {
            connectTimeout = COVER_TIMEOUT_MS
            readTimeout = COVER_TIMEOUT_MS
        }.inputStream
    } else {
        context.contentResolver.openInputStream(Uri.parse(uri))
    }

    private fun decodeCover(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val options = BitmapFactory.Options().apply {
            inSampleSize = coverSampleSize(maxOf(bounds.outWidth, bounds.outHeight), MAX_COVER_SIZE_PX)
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }

    private fun encodeCover(bitmap: Bitmap): ByteArray {
        val scale = minOf(1f, MAX_COVER_SIZE_PX.toFloat() / maxOf(bitmap.width, bitmap.height))
        val scaled = if (scale < 1f) {
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
        } else {
            bitmap
        }
        return ByteArrayOutputStream().use { stream ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 90, stream)
            stream.toByteArray()
        }
    }
}

// PlaybackState meldet die Position zum Zeitpunkt lastPositionUpdateTime; waehrend der Wiedergabe
// laeuft sie seitdem mit playbackSpeed weiter (wie Timeline in WindowsMediaStatusReader).
internal fun currentPositionMs(positionMs: Long, updateTime: Long, speed: Float, playing: Boolean, now: Long): Long =
    if (playing && updateTime > 0) positionMs + ((now - updateTime) * speed).toLong() else positionMs

// Die Adresse kommt von einer beliebigen Medien-App: file:// bleibt draussen, damit sie keine
// Dateien aus dem Speicher dieser App zum Cover machen kann.
internal fun isLoadableCoverUri(uri: String): Boolean = uri.substringBefore(':').lowercase() in setOf("content", "http", "https")

/** Alles bis `limit` Bytes, null wenn mehr kommt. */
internal fun readAtMost(stream: InputStream, limit: Int): ByteArray? {
    val buffer = ByteArray(limit + 1)
    var total = 0
    while (total < buffer.size) {
        val read = stream.read(buffer, total, buffer.size - total)
        if (read < 0) break
        total += read
    }
    return if (total > limit) null else buffer.copyOf(total)
}

// Grosse Zweierpotenz, die das Bild nicht unter `target` schrumpft: ein kleines PNG kann riesige
// Abmessungen haben und ungedrosselt den Speicher sprengen.
internal fun coverSampleSize(largestSide: Int, target: Int): Int {
    var sample = 1
    while (largestSide / (sample * 2) >= target) sample *= 2
    return sample
}
