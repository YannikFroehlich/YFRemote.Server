package com.yfremote.android.media

import android.service.notification.NotificationListenerService

// Bleibt leer: MediaSessionManager.getActiveSessions verlangt einen vom Nutzer freigegebenen
// NotificationListener ("Benachrichtigungszugriff"). Benachrichtigungen selbst liest YFRemote nicht.
class MediaAccessListener : NotificationListenerService()
