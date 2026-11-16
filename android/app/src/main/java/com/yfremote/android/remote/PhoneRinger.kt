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
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.yfremote.android.R

// "Gerät klingeln lassen" im Tray des PCs: Der Web-Client ruft YFRemoteRing.start() auf
// (client/src/app/remote/ring-player.ts). Gespielt wird ueber den Wecker-Kanal mit voller Lautstaerke,
// damit das Handy auch lautlos oder im Vibrationsmodus zu hoeren ist; die vorige Wecker-Lautstaerke
// kommt beim Stoppen zurueck. "Stopp" in der Benachrichtigung meldet sich mit onStopped zurueck.
internal class PhoneRinger(
    private val activity: Activity,
    private val onStopped: () -> Unit,
) {
    private val notifications = activity.getSystemService(NotificationManager::class.java)
    private val audio = activity.getSystemService(AudioManager::class.java)
    private var player: MediaPlayer? = null
    private var previousVolume: Int? = null

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            stop()
            onStopped()
        }
    }

    init {
        ContextCompat.registerReceiver(activity, receiver, IntentFilter(ACTION_STOP), ContextCompat.RECEIVER_NOT_EXPORTED)
        if (notifications.getNotificationChannel(CHANNEL_ID) == null) {
            notifications.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, activity.getString(R.string.ring_channel_name), NotificationManager.IMPORTANCE_HIGH),
            )
        }
    }

    fun start() {
        if (player != null) return
        previousVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0) }
        val uri = RingtoneManager.getActualDefaultRingtoneUri(activity, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getActualDefaultRingtoneUri(activity, RingtoneManager.TYPE_RINGTONE)
            ?: Settings.System.DEFAULT_NOTIFICATION_URI
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(activity, uri)
                isLooping = true
                prepare()
                start()
            }
        }.getOrNull()
        showNotification()
    }

    fun stop() {
        player?.run {
            runCatching { stop() }
            release()
        }
        player = null
        previousVolume?.let { runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, it, 0) } }
        previousVolume = null
        notifications.cancel(NOTIFICATION_ID)
    }

    fun release() {
        stop()
        activity.unregisterReceiver(receiver)
    }

    private fun showNotification() {
        val open = PendingIntent.getActivity(
            activity,
            0,
            Intent(activity, RemoteWebActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getBroadcast(
            activity,
            0,
            Intent(ACTION_STOP).setPackage(activity.packageName),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(activity, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(activity.getString(R.string.ring_title))
            .setContentIntent(open)
            .setDeleteIntent(stop)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_ALARM)
            .addAction(Notification.Action.Builder(Icon.createWithResource(activity, R.drawable.ic_notification), activity.getString(R.string.ring_stop), stop).build())
            .build()
        runCatching { notifications.notify(NOTIFICATION_ID, notification) }
    }

    private companion object {
        const val CHANNEL_ID = "yfremote_ring"
        const val NOTIFICATION_ID = 4
        const val ACTION_STOP = "com.yfremote.android.RING_STOP"
    }
}
