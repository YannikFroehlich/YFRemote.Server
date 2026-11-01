package com.yfremote.android.server

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import com.yfremote.android.server.models.SystemStatsMessage
import kotlin.math.roundToInt

// Android-Aequivalent zu WindowsSystemStatsReader, beschraenkt auf das, was Apps lesen duerfen:
// Arbeitsspeicher und Akku. CPU-Last (/proc/stat seit Android 8) und CPU-/GPU-Temperaturen sind fuer
// normale Apps gesperrt und fehlen deshalb, wie am PC ein nicht lieferbarer Wert.
class SystemStatsReader(private val context: Context) {

    fun read(): SystemStatsMessage {
        val memory = ActivityManager.MemoryInfo().also { context.getSystemService(ActivityManager::class.java).getMemoryInfo(it) }
        // Sticky-Broadcast: liefert den letzten Akkustand sofort, ohne Empfaenger und ohne Berechtigung.
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val present = battery?.getBooleanExtra(BatteryManager.EXTRA_PRESENT, false) == true
        val temperature = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE

        return SystemStatsMessage(
            type = "systemStats",
            memoryUsedMb = (memory.totalMem - memory.availMem) / MB,
            memoryTotalMb = memory.totalMem / MB,
            batteryLevel = battery?.takeIf { present }?.let {
                batteryPercent(it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), it.getIntExtra(BatteryManager.EXTRA_SCALE, -1))
            },
            batteryCharging = battery?.takeIf { present }?.let { it.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0 },
            // EXTRA_TEMPERATURE in Zehntelgrad.
            batteryTemperature = if (present && temperature != Int.MIN_VALUE) (temperature / 10.0).roundToInt() else null,
        )
    }

    private companion object {
        const val MB = 1024L * 1024L
    }
}

internal fun batteryPercent(level: Int, scale: Int): Int? =
    if (level < 0 || scale <= 0) null else (level * 100.0 / scale).roundToInt().coerceIn(0, 100)
