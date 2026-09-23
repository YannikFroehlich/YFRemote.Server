package com.yfremote.android.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityService.GestureResultCallback
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent

// Android-Aequivalent zur Kombination aus WindowsMouseService/WindowsInputSender fuer alles,
// was ueber Gesten und globale Aktionen laeuft (siehe PLAN.md, Stufen 2 und 4). Eine
// AccessibilityService-Instanz pro Prozess, per Companion-Singleton erreichbar - gleiches Muster
// wie schon in Stufe 0 (TapAccessibilityService.instance).
class YFRemoteAccessibilityService : AccessibilityService() {

    companion object {
        var instance: YFRemoteAccessibilityService? = null
            private set

        private const val TAG = "YFRemoteAccessibility"
        private const val TAP_DURATION_MS = 50L
        private const val LONG_PRESS_DURATION_MS = 600L
        private const val SCROLL_DURATION_MS = 150L
        private const val SCROLL_PIXELS_PER_UNIT = 0.5f
        private const val MIN_SCROLL_DISTANCE_PX = 40f
        private const val MAX_SCROLL_DISTANCE_PX = 400f
    }

    private var overlay: VirtualCursorOverlay? = null
    private var cursorX = 0f
    private var cursorY = 0f
    private var activeStroke: GestureDescription.StrokeDescription? = null
    private var dragEndX = 0f
    private var dragEndY = 0f

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        overlay = VirtualCursorOverlay(this)
        val metrics = resources.displayMetrics
        cursorX = metrics.widthPixels / 2f
        cursorY = metrics.heightPixels / 2f
        Log.i(TAG, "Accessibility-Dienst verbunden.")
    }

    override fun onDestroy() {
        overlay?.hide()
        overlay = null
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    /** Bewegt den virtuellen Cursor; setzt waehrend eines aktiven Drags die Gesture-Stroke fort. */
    fun moveCursor(deltaX: Int, deltaY: Int) {
        val metrics = resources.displayMetrics
        cursorX = (cursorX + deltaX).coerceIn(0f, metrics.widthPixels - 1f)
        cursorY = (cursorY + deltaY).coerceIn(0f, metrics.heightPixels - 1f)

        if (overlay == null) overlay = VirtualCursorOverlay(this)
        overlay?.show(cursorX, cursorY)

        activeStroke?.let { continueDragStroke(willContinue = true) }
    }

    fun tap() = dispatchStroke(cursorPath(), TAP_DURATION_MS)

    fun longPress() = dispatchStroke(cursorPath(), LONG_PRESS_DURATION_MS)

    fun mouseDown() {
        val stroke = GestureDescription.StrokeDescription(cursorPath(), 0, TAP_DURATION_MS, true)
        activeStroke = stroke
        dragEndX = cursorX
        dragEndY = cursorY
        dispatch(GestureDescription.Builder().addStroke(stroke).build())
    }

    fun mouseUp() = continueDragStroke(willContinue = false)

    // Eine fortgesetzte Stroke muss dort beginnen, wo die vorherige endete - ein blosser
    // moveTo(Cursor) an neuer Position bricht die Geste ab (Log: "Geste abgebrochen").
    private fun continueDragStroke(willContinue: Boolean) {
        val stroke = activeStroke ?: return
        val path = Path().apply {
            moveTo(dragEndX, dragEndY)
            if (dragEndX != cursorX || dragEndY != cursorY) lineTo(cursorX, cursorY)
        }
        dragEndX = cursorX
        dragEndY = cursorY
        val continued = stroke.continueStroke(path, 0, TAP_DURATION_MS, willContinue)
        activeStroke = if (willContinue) continued else null
        dispatch(GestureDescription.Builder().addStroke(continued).build())
    }

    fun scroll(deltaX: Int?, deltaY: Int?) {
        val dx = (deltaX ?: 0) * SCROLL_PIXELS_PER_UNIT
        // Ein positives Scroll-Delta bedeutet "Inhalt nach unten scrollen" -> der Finger wischt
        // nach oben, daher das Vorzeichen drehen (gleiche Konvention wie touchpad.component.ts).
        val dy = -(deltaY ?: 0) * SCROLL_PIXELS_PER_UNIT

        val distance = kotlin.math.hypot(dx, dy).coerceIn(MIN_SCROLL_DISTANCE_PX, MAX_SCROLL_DISTANCE_PX)
        if (distance <= 0f) return

        val scale = distance / kotlin.math.max(kotlin.math.hypot(dx, dy), 0.01f)
        val endX = (cursorX + dx * scale).coerceIn(0f, resources.displayMetrics.widthPixels - 1f)
        val endY = (cursorY + dy * scale).coerceIn(0f, resources.displayMetrics.heightPixels - 1f)

        val path = Path().apply {
            moveTo(cursorX, cursorY)
            lineTo(endX, endY)
        }
        dispatchStroke(path, SCROLL_DURATION_MS)
    }

    fun lockScreen(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        return performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
    }

    fun goHome(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)

    fun goBack(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)

    fun openRecents(): Boolean = performGlobalAction(GLOBAL_ACTION_RECENTS)

    private fun cursorPath() = Path().apply { moveTo(cursorX, cursorY) }

    private fun dispatchStroke(path: Path, durationMs: Long) {
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
        dispatch(GestureDescription.Builder().addStroke(stroke).build())
    }

    // dispatchGesture() meldet Fehler nur ueber Rueckgabewert und Callback - ohne das Log ist eine
    // abgelehnte oder abgebrochene Geste auf dem steuernden Geraet nicht von "Erfolg" zu
    // unterscheiden, weil die Antwort schon raus ist, bevor die Geste laeuft.
    private fun dispatch(gesture: GestureDescription) {
        val accepted = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCancelled(description: GestureDescription?) {
                Log.w(TAG, "Geste abgebrochen (x=$cursorX, y=$cursorY).")
            }
        }, null)
        if (!accepted) Log.w(TAG, "Geste abgelehnt (x=$cursorX, y=$cursorY).")
    }
}
