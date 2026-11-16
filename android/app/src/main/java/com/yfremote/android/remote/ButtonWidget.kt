package com.yfremote.android.remote

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.yfremote.android.R

// Ein eigener Button des Web-Clients als Widget, z. B. "PC sperren". Welcher, waehlt man beim
// Ablegen (ButtonPickerActivity); ein Tipp sendet sein Makro ueber MediaWidgetService, wie die Tasten
// des Medien-Widgets.
class ButtonWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, views(context, it)) }
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val targets = ButtonTargets(context)
        ids.forEach { targets.remove(ButtonTargets.widgetKey(it)) }
    }

    internal companion object {
        /** Neu zeichnen, wenn sich Beschriftungen geaendert haben koennten (RemoteDevices.setButtons). */
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            manager.getAppWidgetIds(ComponentName(context, ButtonWidget::class.java))
                .forEach { manager.updateAppWidget(it, views(context, it)) }
        }

        fun views(context: Context, widgetId: Int): RemoteViews {
            val key = ButtonTargets.widgetKey(widgetId)
            val resolved = ButtonTargets(context).resolve(key)
            val views = RemoteViews(context.packageName, R.layout.widget_custom_button)
            views.setTextViewText(R.id.widget_button_label, resolved?.button?.label ?: context.getString(R.string.button_target_missing_short))
            views.setTextViewText(R.id.widget_button_device, resolved?.device?.name ?: "")
            val intent = Intent(context, MediaWidgetService::class.java).putExtra(MediaWidgetService.EXTRA_TARGET, key)
            views.setOnClickPendingIntent(
                R.id.widget_button_root,
                PendingIntent.getForegroundService(context, widgetId, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
            )
            return views
        }
    }
}
