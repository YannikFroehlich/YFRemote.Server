package com.yfremote.android.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.WindowManager

// Zeigt einen kleinen Cursor-Marker ueber allen Apps, weil Android - anders als Windows/Linux -
// keinen Systemcursor kennt, den man einfach bewegen koennte (siehe PLAN.md, Stufe 2).
// TYPE_ACCESSIBILITY_OVERLAY statt TYPE_APPLICATION_OVERLAY: von einer AccessibilityService aus
// erzeugt, braucht keine separate SYSTEM_ALERT_WINDOW-Berechtigung.
class VirtualCursorOverlay(private val service: AccessibilityService) {

    private val windowManager = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val density = service.resources.displayMetrics.density
    private val markerSizePx = (16 * density).toInt()

    private var marker: View? = null

    fun show(x: Float, y: Float) {
        if (marker == null) {
            val view = View(service).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.parseColor("#4CAF50"))
                    setStroke((2 * density).toInt(), Color.WHITE)
                }
            }
            val params = WindowManager.LayoutParams(
                markerSizePx,
                markerSizePx,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            ).apply { gravity = Gravity.TOP or Gravity.START }

            windowManager.addView(view, params)
            marker = view
        }

        move(x, y)
    }

    fun move(x: Float, y: Float) {
        val view = marker ?: return
        val params = view.layoutParams as WindowManager.LayoutParams
        params.x = (x - markerSizePx / 2f).toInt()
        params.y = (y - markerSizePx / 2f).toInt()
        windowManager.updateViewLayout(view, params)
    }

    fun hide() {
        marker?.let { runCatching { windowManager.removeView(it) } }
        marker = null
    }
}
