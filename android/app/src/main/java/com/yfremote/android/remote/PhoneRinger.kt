package com.yfremote.android.remote

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
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.yfremote.android.R

// "Gerät klingeln lassen" im Tray des PCs: Der Web-Client ruft YFRemoteRing.start() auf
// (client/src/app/remote/ring-player.ts), bei geschlossener App RingListenerService. Einmal pro
// Prozess, damit beide zusammen nur einen Ton spielen. Gespielt wird ueber den Wecker-Kanal mit
// voller Lautstaerke, damit das Handy auch lautlos oder im Vibrationsmodus zu hoeren ist; die vorige
// Wecker-Lautstaerke kommt beim Stoppen zurueck. "Stopp" in der Benachrichtigung meldet sich bei den
// Zuhoerern zurueck (der Web-Client blendet dann sein Vollbild aus).
internal object PhoneRinger {
    private const val CHANNEL_ID = "yfremote_ring"
    private const val NOTIFICATION_ID = 4
    private const val ACTION_STOP = "com.yfremote.android.RING_STOP"

    private val main = Handler(Looper.getMainLooper())
    private var context: Context? = null
    private var player: MediaPlayer? = null
    private var previousVolume: Int? = null
    private val stopListeners = mutableSetOf<() -> Unit>()

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            stop()
            stopListeners.toList().forEach { it() }
        }
    }

    fun addStopListener(listener: () -> Unit) = main.post { stopListeners += listener }

    fun removeStopListener(listener: () -> Unit) = main.post { stopListeners -= listener }

    fun start(caller: Context) = main.post {
        val app = init(caller)
        if (player != null) return@post
        val audio = app.getSystemService(AudioManager::class.java)
        previousVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
        runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0) }
        val uri = RingtoneManager.getActualDefaultRingtoneUri(app, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getActualDefaultRingtoneUri(app, RingtoneManager.TYPE_RINGTONE)
            ?: Settings.System.DEFAULT_NOTIFICATION_URI
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(app, uri)
                isLooping = true
                prepare()
                start()
            }
        }.getOrNull()
        showNotification(app)
    }

    fun stop() = main.post {
        val app = context ?: return@post
        player?.run {
            runCatching { stop() }
            release()
        }
        player = null
        previousVolume?.let { volume ->
            runCatching { app.getSystemService(AudioManager::class.java).setStreamVolume(AudioManager.STREAM_ALARM, volume, 0) }
        }
        previousVolume = null
        app.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }

    private fun init(caller: Context): Context = context ?: caller.applicationContext.also { app ->
        context = app
        ContextCompat.registerReceiver(app, receiver, IntentFilter(ACTION_STOP), ContextCompat.RECEIVER_NOT_EXPORTED)
        val notifications = app.getSystemService(NotificationManager::class.java)
        if (notifications.getNotificationChannel(CHANNEL_ID) == null) {
            notifications.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, app.getString(R.string.ring_channel_name), NotificationManager.IMPORTANCE_HIGH),
            )
        }
    }

    private fun showNotification(app: Context) {
        // Oeffnet die App; ein gesteuertes Geraet laesst sich ohne dessen Adresse nicht direkt oeffnen.
        val open = app.packageManager.getLaunchIntentForPackage(app.packageName)?.let {
            PendingIntent.getActivity(app, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        val stop = PendingIntent.getBroadcast(
            app,
            0,
            Intent(ACTION_STOP).setPackage(app.packageName),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(app, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(app.getString(R.string.ring_title))
            .setContentIntent(open ?: stop)
            .setDeleteIntent(stop)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_ALARM)
            .addAction(Notification.Action.Builder(Icon.createWithResource(app, R.drawable.ic_notification), app.getString(R.string.ring_stop), stop).build())
            .build()
        runCatching { app.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification) }
    }
}
