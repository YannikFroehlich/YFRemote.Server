package com.yfremote.android.remote

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import com.yfremote.android.R

// Waehlt den eigenen Button fuer ein ButtonWidget (beim Ablegen) oder eine Schnellkachel (beim ersten
// Tippen oder lange druecken). Zur Auswahl stehen die Buttons, die RemoteWebActivity aus den
// Oberflaechen der Geraete kopiert hat.
class ButtonPickerActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val tileSlot = tileSlot(intent)
        val key = when {
            widgetId != AppWidgetManager.INVALID_APPWIDGET_ID -> ButtonTargets.widgetKey(widgetId)
            tileSlot != null -> ButtonTargets.tileKey(tileSlot)
            else -> return finish()
        }

        val devices = RemoteDevices(this)
        val options = devices.load().flatMap { device -> devices.buttons(device.url).map { device to it } }
        title = getString(R.string.button_picker_title)
        if (options.isEmpty()) {
            setContentView(
                TextView(this).apply {
                    setText(R.string.button_picker_empty)
                    setPadding(48, 48, 48, 48)
                    textSize = 16f
                },
            )
            return
        }

        val list = ListView(this)
        list.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_list_item_1,
            options.map { (device, button) -> "${button.label}  ·  ${device.name}" },
        )
        list.setOnItemClickListener { _, _, position, _ ->
            val (device, button) = options[position]
            ButtonTargets(this).set(key, ButtonTargets.Target(device.url, button.id))
            if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                AppWidgetManager.getInstance(this).updateAppWidget(widgetId, ButtonWidget.views(this, widgetId))
                setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
            } else {
                ButtonTileService.refresh(this, tileSlot!!)
            }
            finish()
        }
        setContentView(list)
    }

    private fun tileSlot(intent: Intent): Int? {
        if (intent.hasExtra(EXTRA_TILE_SLOT)) return intent.getIntExtra(EXTRA_TILE_SLOT, 1)
        // Langes Druecken auf die Kachel (ACTION_QS_TILE_PREFERENCES) nennt nur deren Klasse.
        @Suppress("DEPRECATION")
        val component = intent.getParcelableExtra<ComponentName>(Intent.EXTRA_COMPONENT_NAME) ?: return null
        return ButtonTileService.slotOf(component.className)
    }

    companion object {
        const val EXTRA_TILE_SLOT = "tileSlot"

        fun tileIntent(activity: android.content.Context, slot: Int): Intent =
            Intent(activity, ButtonPickerActivity::class.java)
                .putExtra(EXTRA_TILE_SLOT, slot)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
