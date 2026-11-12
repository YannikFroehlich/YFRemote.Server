package com.yfremote.android.remote

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.yfremote.android.R
import com.yfremote.android.SetupActivity

// Medien-Widget auf dem Startbildschirm: Wiedergabe und Lautstaerke des zuletzt geoeffneten Geraets,
// ohne die App zu oeffnen. Die Tasten starten MediaWidgetService, nicht diesen Empfaenger: ein
// Broadcast-Empfaenger laeuft als Hintergrund-Prozess, und dem sperrt Android ab 15 das Netz
// (siehe RemoteMediaService).
class MediaWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        manager.updateAppWidget(ids, views(context))
    }

    internal companion object {
        const val EXTRA_KEY = "key"
        private val BUTTONS = mapOf(
            R.id.widget_volume_down to "VOLUME_DOWN",
            R.id.widget_previous to "MEDIA_PREVIOUS",
            R.id.widget_play_pause to "MEDIA_PLAY_PAUSE",
            R.id.widget_next to "MEDIA_NEXT",
            R.id.widget_volume_up to "VOLUME_UP",
        )
        val KEYS = BUTTONS.values.toSet()

        /** Neu zeichnen, wenn sich das Zielgeraet geaendert hat (RemoteWebActivity). */
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, MediaWidget::class.java))
            if (ids.isNotEmpty()) manager.updateAppWidget(ids, views(context))
        }

        private fun views(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_media)
            val device = RemoteDevices(context).last()
            views.setTextViewText(R.id.widget_name, device?.name ?: context.getString(R.string.widget_no_device))
            // Der Name oeffnet die Oberflaeche des Geraets, ohne Geraet die App.
            val open = if (device == null) {
                Intent(context, SetupActivity::class.java)
            } else {
                Intent(context, RemoteWebActivity::class.java)
                    .putExtra(RemoteWebActivity.EXTRA_URL, device.url)
                    .putExtra(RemoteWebActivity.EXTRA_NAME, device.name)
                    .putExtra(RemoteWebActivity.EXTRA_CA, device.ca)
            }
            views.setOnClickPendingIntent(
                R.id.widget_name,
                PendingIntent.getActivity(
                    context,
                    0,
                    open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            BUTTONS.entries.forEachIndexed { index, (id, key) ->
                val intent = Intent(context, MediaWidgetService::class.java).putExtra(EXTRA_KEY, key)
                views.setOnClickPendingIntent(
                    id,
                    PendingIntent.getForegroundService(context, index + 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
                )
            }
            return views
        }
    }
}
