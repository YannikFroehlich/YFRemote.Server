package com.yfremote.android.remote

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.yfremote.android.R
import kotlin.concurrent.thread

// Schnellkacheln "YFRemote 1-3": je ein eigener Button des Web-Clients. Android kennt nur fest im
// Manifest eingetragene Kacheln, daher drei feste Plaetze. Die erste Beruehrung einer leeren Kachel
// oder langes Druecken waehlt den Button (ButtonPickerActivity).
abstract class ButtonTileService(private val slot: Int) : TileService() {

    private val key get() = ButtonTargets.tileKey(slot)

    override fun onStartListening() {
        val tile = qsTile ?: return
        val resolved = ButtonTargets(this).resolve(key)
        tile.label = resolved?.button?.label ?: getString(R.string.tile_label, slot)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.subtitle = resolved?.device?.name
        tile.state = if (resolved == null) Tile.STATE_INACTIVE else Tile.STATE_ACTIVE
        tile.updateTile()
    }

    override fun onClick() {
        val resolved = ButtonTargets(this).resolve(key)
        if (resolved == null) {
            openPicker()
            return
        }
        // Wie das Widget ueber den Vordergrund-Dienst: nur so hat die App im Hintergrund Netz.
        try {
            startForegroundService(Intent(this, MediaWidgetService::class.java).putExtra(MediaWidgetService.EXTRA_TARGET, key))
        } catch (e: IllegalStateException) {
            // Verweigert Android den Start (ForegroundServiceStartNotAllowedException), direkt senden:
            // die von der Systemoberflaeche gebundene Kachel lebt noch, solange das Feld offen ist.
            val token = resolved.token ?: return
            thread { RemoteClient(resolved.device, token).sendSteps(resolved.button.steps) }
        }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openPicker() {
        val intent = ButtonPickerActivity.tileIntent(this, slot)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(PendingIntent.getActivity(this, slot, intent, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    companion object {
        private val SERVICES = listOf(ButtonTile1::class.java, ButtonTile2::class.java, ButtonTile3::class.java)

        fun slotOf(className: String): Int? = SERVICES.indexOfFirst { it.name == className }.takeIf { it >= 0 }?.plus(1)

        /** Nach einer neuen Auswahl die Beschriftung der Kachel auffrischen. */
        fun refresh(context: Context, slot: Int) {
            SERVICES.getOrNull(slot - 1)?.let { requestListeningState(context, ComponentName(context, it)) }
        }
    }
}

class ButtonTile1 : ButtonTileService(1)
class ButtonTile2 : ButtonTileService(2)
class ButtonTile3 : ButtonTileService(3)
