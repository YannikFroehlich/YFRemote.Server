package com.yfremote.android.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.yfremote.android.R
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

// "Im Hintergrund erreichbar" (Tab "Steuern", standardmaessig aus): haelt zu jedem gekoppelten PC eine
// Verbindung offen, damit "Gerät klingeln lassen" auch bei geschlossener App klingelt. Vordergrund-
// Dienst, weil Android einer App im Hintergrund sonst nach wenigen Sekunden das Netz sperrt.
// ponytail: dataSync wie die uebrigen Dienste; ab targetSdk 35 begrenzt Android ihn auf 6 h am Tag,
// dann auf connectedDevice (mit CHANGE_NETWORK_STATE) umstellen.
class RingListenerService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private val sockets = mutableListOf<WebSocket>()
    private var generation = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isEnabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = notification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        // Neu gekoppelt oder entfernt: alle Verbindungen neu, mit der aktuellen Liste.
        closeAll()
        val devices = RemoteDevices(this)
        devices.load().forEach { device -> devices.token(device.url)?.let { connect(device, it, 0) } }
        return START_STICKY
    }

    override fun onDestroy() {
        closeAll()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun closeAll() {
        generation++
        main.removeCallbacksAndMessages(null)
        sockets.forEach { it.close(1000, null) }
        sockets.clear()
    }

    private fun connect(device: RemoteDevice, token: String, attempt: Int) {
        val current = generation
        val socket = RemoteClient(device, token).listen(
            object : WebSocketListener() {
                private var opened = false

                override fun onOpen(webSocket: WebSocket, response: Response) {
                    opened = true
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                    if (message.optString("type") == "ring") PhoneRinger.start(this@RingListenerService)
                }

                // Schliesst der PC (Neustart, Beenden), muss die App den Abschluss bestaetigen, sonst kommt onClosed nie.
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry(webSocket, null)

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = retry(webSocket, response?.code)

                private fun retry(webSocket: WebSocket, status: Int?) {
                    main.post {
                        sockets -= webSocket
                        // 401: nicht mehr gekoppelt - erst ein neues Token (setToken -> refresh) verbindet wieder.
                        if (current == generation && status != 401) {
                            val next = if (opened) 0 else attempt + 1
                            main.postDelayed({ if (current == generation) connect(device, token, next) }, retryDelayMs(next))
                        }
                    }
                }
            },
        )
        sockets += socket
    }

    private fun notification(): Notification {
        val notifications = getSystemService(NotificationManager::class.java)
        if (notifications.getNotificationChannel(CHANNEL_ID) == null) {
            notifications.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.listener_channel_name), NotificationManager.IMPORTANCE_MIN),
            )
        }
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.listener_title))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    /** Startet den Dienst nach dem Hochfahren, wenn er an war. */
    class BootReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_BOOT_COMPLETED) refresh(context)
        }
    }

    companion object {
        private const val NOTIFICATION_ID = 5
        private const val CHANNEL_ID = "yfremote_listener"
        private const val PREFS = "ring_listener"
        private const val KEY_ENABLED = "enabled"

        fun isEnabled(context: Context): Boolean =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

        fun setEnabled(context: Context, enabled: Boolean) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
            if (enabled) refresh(context) else context.stopService(Intent(context, RingListenerService::class.java))
        }

        /** Verbindet neu, falls an - nach Koppeln oder Entfernen eines Geraets. */
        fun refresh(context: Context) {
            if (!isEnabled(context)) return
            // Aus dem Hintergrund (z. B. ein Widget-Dienst) darf Android den Start ablehnen; dann gilt
            // die neue Liste beim naechsten Start.
            runCatching { context.startForegroundService(Intent(context, RingListenerService::class.java)) }
        }

        /** Versuch 0 (die Verbindung stand schon): 2 s. Danach 5 s, 10 s, 20 s ... hoechstens 1 min. */
        fun retryDelayMs(attempt: Int): Long =
            if (attempt == 0) 2_000L else minOf(60_000L, 5_000L shl (attempt - 1).coerceAtMost(4))
    }
}
