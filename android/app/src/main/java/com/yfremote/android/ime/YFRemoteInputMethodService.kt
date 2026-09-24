package com.yfremote.android.ime

import android.inputmethodservice.InputMethodService
import android.text.InputType
import android.os.SystemClock
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.yfremote.android.R

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

    // Tippen kommt vom gekoppelten Geraet, es gibt also keine Tasten zu zeichnen. Trotzdem keine
    // 1x1-View mehr: solange diese IME ausgewaehlt ist, haette das Telefon sonst gar keine
    // bedienbare Tastatur mehr, und der Weg zurueck fuehrt nur ueber die Systemeinstellungen.
    override fun onCreateInputView(): View {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(ContextCompat.getColor(context, R.color.brand_surface))
            setPadding(dp(12), dp(8), dp(12), dp(8))

            addView(
                TextView(this@YFRemoteInputMethodService).apply {
                    text = "YFRemote: Eingabe kommt vom gekoppelten Gerät"
                    textSize = 14f
                    setTextColor(ContextCompat.getColor(context, R.color.brand_text))
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                },
            )
            addView(
                Button(this@YFRemoteInputMethodService).apply {
                    text = "Andere Tastatur"
                    setOnClickListener { switchAwayFromThisIme() }
                },
            )
        }
    }

    // switchToPreviousInputMethod() springt direkt zur zuletzt genutzten Tastatur zurueck; gibt es
    // keine (erste Nutzung nach dem Aktivieren), bleibt nur der System-Auswahldialog.
    private fun switchAwayFromThisIme() {
        if (switchToPreviousInputMethod()) return
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
    }

    // Ohne fokussiertes Textfeld liefert Android trotzdem eine InputConnection des Fensters, deren
    // commitText() den Text verwirft und true meldet - der Client haette sonst "Erfolg" gezeigt.
    fun commitText(text: String): Boolean {
        val hasTextField = currentInputStarted &&
            (currentInputEditorInfo?.inputType ?: InputType.TYPE_NULL) != InputType.TYPE_NULL
        return hasTextField && currentInputConnection?.commitText(text, 1) == true
    }

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
