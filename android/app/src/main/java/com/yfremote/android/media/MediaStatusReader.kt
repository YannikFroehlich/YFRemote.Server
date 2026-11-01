package com.yfremote.android.media

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import com.yfremote.android.server.DeviceVolume
import com.yfremote.android.server.models.MediaStatusMessage
import java.io.ByteArrayOutputStream

// Android-Aequivalent zu WindowsMediaStatusReader: Lautstaerke von DeviceVolume, Titel, Zeitleiste und
// Cover von der aktiven MediaSession. Ohne Benachrichtigungszugriff bleibt es bei der Lautstaerke.
class MediaStatusReader(private val context: Context, private val audioManager: AudioManager) {

    companion object {
        private const val MAX_COVER_SIZE_PX = 512
        private const val MAX_COVER_BYTES = 2 * 1024 * 1024
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
    // ponytail: nur eingebettete Bitmaps; Apps, die nur METADATA_KEY_ALBUM_ART_URI setzen, bleiben ohne Cover.
    private fun updateCover(packageName: String?, metadata: MediaMetadata?): String? = synchronized(coverLock) {
        val bitmap = metadata?.let {
            it.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
                ?: it.getBitmap(MediaMetadata.METADATA_KEY_ART)
                ?: it.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        }
        val key = if (bitmap != null && metadata != null) {
            listOf(
                packageName,
                metadata.getString(MediaMetadata.METADATA_KEY_TITLE),
                metadata.getString(MediaMetadata.METADATA_KEY_ALBUM),
                "${bitmap.width}x${bitmap.height}",
            ).joinToString("|")
        } else {
            null
        }
        if (key == coverKey) return coverId

        coverKey = key
        val bytes = bitmap?.let(::encodeCover)?.takeIf { it.size <= MAX_COVER_BYTES }
        cover = bytes
        coverId = bytes?.let { Integer.toHexString(it.contentHashCode()) }
        coverId
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
