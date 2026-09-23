package com.yfremote.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.AudioManager
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.yfremote.android.R
import com.yfremote.android.SetupActivity
import com.yfremote.android.accessibility.YFRemoteAccessibilityService
import com.yfremote.android.ime.YFRemoteInputMethodService
import com.yfremote.android.server.ClipboardBridge
import com.yfremote.android.server.ClipboardOptions
import com.yfremote.android.server.ConnectionRegistry
import com.yfremote.android.server.FileTransferBridge
import com.yfremote.android.server.FileTransferOptions
import com.yfremote.android.server.KtorServer
import com.yfremote.android.server.PairingRepository
import com.yfremote.android.server.RemoteActionRouter

// Haelt den Prozess am Leben, waehrend der Ktor-Server laeuft - Android wuerde einen reinen
// Hintergrundprozess sonst jederzeit beenden (siehe PLAN.md, Stufe 5). Android-Aequivalent zum
// dauerhaft laufenden YFRemote.Server.exe-Prozess unter Windows/Linux.
class YFRemoteForegroundService : Service() {

    companion object {
        const val ACTION_STOP = "com.yfremote.android.action.STOP"
        private const val CHANNEL_ID = "yfremote_service"
        private const val NOTIFICATION_ID = 1

        var instance: YFRemoteForegroundService? = null
            private set
        var isRunning = false
            private set
    }

    lateinit var pairing: PairingRepository
        private set

    private lateinit var connectionRegistry: ConnectionRegistry
    private lateinit var server: KtorServer

    override fun onCreate() {
        super.onCreate()
        instance = this

        connectionRegistry = ConnectionRegistry()
        pairing = PairingRepository(filesDir)

        val router = RemoteActionRouter(
            audioManager = getSystemService(AUDIO_SERVICE) as AudioManager,
            accessibilityService = { YFRemoteAccessibilityService.instance },
            imeService = { YFRemoteInputMethodService.instance },
        )

        server = KtorServer(
            context = applicationContext,
            port = KtorServer.DEFAULT_PORT,
            pairing = pairing,
            router = router,
            connectionRegistry = connectionRegistry,
            fileTransferBridge = FileTransferBridge(applicationContext, FileTransferOptions().maxFileSizeBytes),
            clipboardBridge = ClipboardBridge(applicationContext),
            clipboardOptions = ClipboardOptions(),
            fileTransferOptions = FileTransferOptions(),
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification())
        server.start()
        isRunning = true
        return START_STICKY
    }

    override fun onDestroy() {
        server.stop()
        isRunning = false
        instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    fun refreshNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun buildNotification(): Notification {
        ensureChannel()

        val stopIntent = PendingIntent.getService(
            this,
            0,
            Intent(this, YFRemoteForegroundService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, SetupActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val pin = pairing.getCurrentPin().first

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text, pin))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(contentIntent)
            .addAction(0, getString(R.string.notification_stop), stopIntent)
            .setOngoing(true)
            .build()
    }

    private fun ensureChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_LOW),
            )
        }
    }
}
