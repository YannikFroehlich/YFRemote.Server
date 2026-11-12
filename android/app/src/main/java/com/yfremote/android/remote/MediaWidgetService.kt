package com.yfremote.android.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.widget.Toast
import com.yfremote.android.R
import kotlin.concurrent.thread
import org.json.JSONObject

// Sendet eine Taste des Medien-Widgets. Ein Vordergrund-Dienst, weil die App nur so im Hintergrund
// Netz hat (siehe RemoteMediaService); einen Tipp aufs Widget darf Android dafuer starten lassen.
// Er endet nach der Antwort - schneller als die 10 s, nach denen Android seine Benachrichtigung
// ueberhaupt erst zeigt.
class MediaWidgetService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        val key = intent?.getStringExtra(MediaWidget.EXTRA_KEY)?.takeIf { it in MediaWidget.KEYS }
        val devices = RemoteDevices(this)
        val device = devices.last()
        val token = device?.let { devices.token(it.url) }
        if (key == null || device == null || token == null) {
            if (key != null) toast(getString(R.string.widget_no_device))
            stopSelf(startId)
            return START_NOT_STICKY
        }

        thread {
            RemoteClient(device, token).send(JSONObject().put("type", "key").put("key", key)).message(device.name)?.let(::toast)
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private fun startInForeground() {
        val notifications = getSystemService(NotificationManager::class.java)
        if (notifications.getNotificationChannel(CHANNEL_ID) == null) {
            notifications.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.widget_channel_name), NotificationManager.IMPORTANCE_MIN),
            )
        }
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.widget_channel_name))
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun toast(message: String) =
        Handler(mainLooper).post { Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show() }

    private companion object {
        const val CHANNEL_ID = "yfremote_widget"
        const val NOTIFICATION_ID = 3
    }
}
