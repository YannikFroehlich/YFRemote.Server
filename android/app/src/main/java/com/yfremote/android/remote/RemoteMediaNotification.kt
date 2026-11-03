package com.yfremote.android.remote

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.SystemClock
import android.util.Base64
import androidx.core.content.ContextCompat
import com.yfremote.android.R
import org.json.JSONObject

// Wiedergabe des gesteuerten Geraets als Media-Benachrichtigung (auch Sperrbildschirm), solange
// RemoteWebActivity verbunden ist; RemoteMediaService haelt dafuer im Hintergrund das Netz. Die Daten meldet der Web-Client ueber YFRemoteMedia
// (client/src/app/remote/media-bridge.service.ts), Tasten gehen als 'yfremote-media'-Ereignis zurueck.
// Medien-Benachrichtigungen brauchen ab Android 13 keine POST_NOTIFICATIONS-Berechtigung.
internal class RemoteMediaNotification(
    private val activity: Activity,
    private val deviceName: String?,
    private val send: (JSONObject) -> Unit,
) {
    private val notifications = activity.getSystemService(NotificationManager::class.java)
    private val contentIntent = PendingIntent.getActivity(
        activity,
        0,
        Intent(activity, RemoteWebActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
        PendingIntent.FLAG_IMMUTABLE,
    )
    private val session = MediaSession(activity, "YFRemote").apply {
        setSessionActivity(contentIntent)
        // Am PC gibt es nur die Umschalttaste - Play und Pause schicken beide dieselbe.
        setCallback(object : MediaSession.Callback() {
            override fun onPlay() = key(PLAY_PAUSE)
            override fun onPause() = key(PLAY_PAUSE)
            override fun onSkipToNext() = key(NEXT)
            override fun onSkipToPrevious() = key(PREVIOUS)
            override fun onSeekTo(pos: Long) = send(JSONObject().put("type", "seek").put("position", pos / 1000.0))
        })
    }

    // Bis Android 12 zeigt die Benachrichtigung ihre eigenen Aktionen, ab 13 die der MediaSession.
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            intent.getStringExtra(EXTRA_KEY)?.let(::key)
        }
    }

    private var title: String? = null
    private var artist: String? = null
    private var duration: Long = -1
    private var playing = false
    private var cover: Bitmap? = null
    private var serviceStarted = false

    val isShowing: Boolean
        get() = title != null

    init {
        ContextCompat.registerReceiver(activity, receiver, IntentFilter(ACTION_KEY), ContextCompat.RECEIVER_NOT_EXPORTED)
        if (notifications.getNotificationChannel(CHANNEL_ID) == null) {
            notifications.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, activity.getString(R.string.media_channel_name), NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    fun update(status: JSONObject) {
        val newTitle = status.optString("title").ifEmpty { return clear() }
        val newArtist = status.optString("artist").ifEmpty { null }
        val newDuration = if (status.has("duration")) status.optLong("duration") * 1000 else -1
        val newPlaying = status.optBoolean("playing")
        val position = if (status.has("position")) status.optLong("position") * 1000 else PlaybackState.PLAYBACK_POSITION_UNKNOWN

        var actions = PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS
        if (status.optBoolean("canSeek")) actions = actions or PlaybackState.ACTION_SEEK_TO
        // Die Zeitleiste laeuft im System selbst weiter; die sekuendlichen Meldungen korrigieren sie nur.
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(actions)
                .setState(
                    if (newPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    position,
                    if (newPlaying) 1f else 0f,
                    SystemClock.elapsedRealtime(),
                )
                .build(),
        )

        val changed = newTitle != title || newArtist != artist || newDuration != duration || newPlaying != playing
        title = newTitle
        artist = newArtist
        duration = newDuration
        playing = newPlaying
        if (changed) show()
    }

    fun cover(dataUrl: String) {
        cover = dataUrl.substringAfter("base64,", "").takeIf { it.isNotEmpty() }?.let {
            runCatching { Base64.decode(it, Base64.DEFAULT).let { bytes -> BitmapFactory.decodeByteArray(bytes, 0, bytes.size) } }.getOrNull()
        }
        if (title != null) show()
    }

    fun clear() {
        if (title == null) return
        title = null
        activity.stopService(Intent(activity, RemoteMediaService::class.java))
        serviceStarted = false
        notifications.cancel(NOTIFICATION_ID)
        session.isActive = false
    }

    fun release() {
        clear()
        session.release()
        activity.unregisterReceiver(receiver)
    }

    private fun key(key: String) = send(JSONObject().put("type", "key").put("key", key))

    private fun show() {
        session.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
                .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cover)
                .build(),
        )
        session.isActive = true

        val notification = Notification.Builder(activity, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(deviceName)
            .setLargeIcon(cover)
            .setContentIntent(contentIntent)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .addAction(action(android.R.drawable.ic_media_previous, "Zurück", PREVIOUS, 1))
            .addAction(
                if (playing) {
                    action(android.R.drawable.ic_media_pause, "Pause", PLAY_PAUSE, 2)
                } else {
                    action(android.R.drawable.ic_media_play, "Abspielen", PLAY_PAUSE, 2)
                },
            )
            .addAction(action(android.R.drawable.ic_media_next, "Weiter", NEXT, 3))
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .build()
        RemoteMediaService.notification = notification
        notifications.notify(NOTIFICATION_ID, notification)
        if (!serviceStarted) {
            // Ab Android 12 nur aus dem Vordergrund erlaubt - sonst beim naechsten show() erneut.
            serviceStarted = runCatching {
                activity.startForegroundService(Intent(activity, RemoteMediaService::class.java))
            }.isSuccess
        }
    }

    private fun action(icon: Int, label: String, key: String, requestCode: Int): Notification.Action {
        val intent = Intent(ACTION_KEY).setPackage(activity.packageName).putExtra(EXTRA_KEY, key)
        val pending = PendingIntent.getBroadcast(activity, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Notification.Action.Builder(Icon.createWithResource(activity, icon), label, pending).build()
    }

    private companion object {
        const val CHANNEL_ID = "yfremote_remote_media"
        const val NOTIFICATION_ID = RemoteMediaService.NOTIFICATION_ID
        const val ACTION_KEY = "com.yfremote.android.REMOTE_MEDIA_KEY"
        const val EXTRA_KEY = "key"
        const val PLAY_PAUSE = "MEDIA_PLAY_PAUSE"
        const val NEXT = "MEDIA_NEXT"
        const val PREVIOUS = "MEDIA_PREVIOUS"
    }
}
