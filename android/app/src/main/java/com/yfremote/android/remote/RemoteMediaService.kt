package com.yfremote.android.remote

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

// Vordergrund-Dienst nur fuer die Dauer der Media-Benachrichtigung (RemoteMediaNotification): Ab
// Android 15 sperrt Android einer App im Hintergrund nach wenigen Sekunden das Netz ("background
// firewall chain"). Die Verbindung zum PC riss ab, die Benachrichtigung blieb auf dem alten Stand
// stehen und ihre Tasten gingen ins Leere. Mit dem Dienst behaelt der Prozess das Netz.
class RemoteMediaService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = notification ?: return START_NOT_STICKY.also { stopSelf() }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    internal companion object {
        const val NOTIFICATION_ID = 2

        // Die zuletzt gezeigte Benachrichtigung, die startForeground braucht - zu gross fuer ein Intent-Extra.
        @Volatile
        var notification: Notification? = null
    }
}
