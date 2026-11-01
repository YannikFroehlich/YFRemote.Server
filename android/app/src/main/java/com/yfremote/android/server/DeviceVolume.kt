package com.yfremote.android.server

import android.media.AudioManager
import com.yfremote.android.server.models.MediaStatusMessage
import kotlin.math.roundToInt

// Medienlautstaerke (STREAM_MUSIC) in Prozent wie am PC. Android kennt nur 15-25 Stufen, ein
// gesetzter Wert springt deshalb auf die naechste Stufe.
object DeviceVolume {
    fun read(audioManager: AudioManager): MediaStatusMessage {
        val stream = AudioManager.STREAM_MUSIC
        return MediaStatusMessage(
            type = "media",
            volume = toPercent(audioManager.getStreamVolume(stream), audioManager.getStreamMaxVolume(stream)),
            muted = audioManager.isStreamMute(stream),
            playing = audioManager.isMusicActive,
        )
    }

    // Hebt wie der Windows-Regler auch die Stummschaltung auf.
    fun set(audioManager: AudioManager, percent: Int) {
        val stream = AudioManager.STREAM_MUSIC
        if (audioManager.isStreamMute(stream)) audioManager.adjustStreamVolume(stream, AudioManager.ADJUST_UNMUTE, 0)
        audioManager.setStreamVolume(stream, toIndex(percent, audioManager.getStreamMaxVolume(stream)), 0)
    }

    internal fun toPercent(index: Int, max: Int): Int = if (max <= 0) 0 else (index * 100.0 / max).roundToInt()

    internal fun toIndex(percent: Int, max: Int): Int = (percent * max / 100.0).roundToInt()
}
