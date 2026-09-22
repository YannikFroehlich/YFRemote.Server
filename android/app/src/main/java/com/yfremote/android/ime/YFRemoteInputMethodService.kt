package com.yfremote.android.ime

import android.inputmethodservice.InputMethodService
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup

// Eigene IME statt Tasten-Passthrough an eine fremde Tastatur (siehe PLAN.md, Stufe 3). Der
// Nutzer muss sie einmalig in den System-Einstellungen aktivieren und als aktive Tastatur
// auswaehlen - eine echte Android-Einschraenkung (nur eine aktive IME gleichzeitig), kein Bug.
class YFRemoteInputMethodService : InputMethodService() {

    companion object {
        var instance: YFRemoteInputMethodService? = null
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // Steuerung erfolgt ausschliesslich fernab vom Geraet selbst - eine 1x1-View reicht, es gibt
    // keine sichtbare Tastatur zu bedienen.
    override fun onCreateInputView(): View =
        View(this).apply { layoutParams = ViewGroup.LayoutParams(1, 1) }

    fun commitText(text: String): Boolean = currentInputConnection?.commitText(text, 1) ?: false

    fun sendKey(key: String): Boolean {
        val keyCode = KeyEventMap.toKeyCode(key) ?: return false
        val ic = currentInputConnection ?: return false
        val now = SystemClock.uptimeMillis()
        ic.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0))
        ic.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0))
        return true
    }

    /** Fuer Strg+A/C/X/V/Z - zuverlaessig in praktisch jedem Textfeld, anders als rohes KeyEvent. */
    fun performEditorAction(actionId: Int): Boolean =
        currentInputConnection?.performContextMenuAction(actionId) ?: false

    /** Best-effort fuer alle anderen Hotkey-Kombinationen - Plattformgrenze, siehe PLAN.md. */
    fun sendHotkeyBestEffort(keys: List<String>): Boolean {
        val ic = currentInputConnection ?: return false
        var metaState = 0
        val nonModifierCodes = mutableListOf<Int>()

        for (key in keys) {
            when (key) {
                "CTRL" -> metaState = metaState or KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON
                "SHIFT" -> metaState = metaState or KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON
                "ALT" -> metaState = metaState or KeyEvent.META_ALT_ON or KeyEvent.META_ALT_LEFT_ON
                "WIN" -> metaState = metaState or KeyEvent.META_META_ON or KeyEvent.META_META_LEFT_ON
                else -> KeyEventMap.toKeyCode(key)?.let { nonModifierCodes.add(it) }
            }
        }

        if (nonModifierCodes.isEmpty()) return false

        val now = SystemClock.uptimeMillis()
        for (code in nonModifierCodes) {
            ic.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0, metaState))
            ic.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0, metaState))
        }
        return true
    }
}
