package com.yfremote.android.ime

import android.view.KeyEvent

// Bildet dieselbe Tastenmenge wie client/src/app/remote/keyboard-keys.ts (SUPPORTED_KEYS) auf
// android.view.KeyEvent-Konstanten ab - Android-Aequivalent zu
// WindowsInputService.VirtualKeys/LinuxInputService's KEY_*-Mapping (siehe PLAN.md, Stufe 3).
// WIN und ESC sind mit im Schluessel-Set (fuer den Meta-State bei Hotkeys), werden als
// alleinstehende "key"-Aktion aber vom RemoteActionRouter abgefangen (Home/Back-Umwidmung,
// siehe PLAN.md, Stufe 4) statt hier als Tastendruck an die IME zu gehen.
object KeyEventMap {

    // Ueber AudioManager statt IME behandelt (siehe RemoteActionRouter) - funktioniert auch ohne
    // fokussiertes Textfeld.
    val AUDIO_KEYS: Set<String> = setOf(
        "VOLUME_MUTE",
        "VOLUME_DOWN",
        "VOLUME_UP",
        "MEDIA_PLAY_PAUSE",
        "MEDIA_NEXT",
        "MEDIA_PREVIOUS",
        "MEDIA_STOP",
    )

    private val KEY_CODES: Map<String, Int> = buildMap {
        put("CTRL", KeyEvent.KEYCODE_CTRL_LEFT)
        put("SHIFT", KeyEvent.KEYCODE_SHIFT_LEFT)
        put("ALT", KeyEvent.KEYCODE_ALT_LEFT)
        put("WIN", KeyEvent.KEYCODE_META_LEFT)
        put("ENTER", KeyEvent.KEYCODE_ENTER)
        put("ESC", KeyEvent.KEYCODE_ESCAPE)
        put("TAB", KeyEvent.KEYCODE_TAB)
        put("SPACE", KeyEvent.KEYCODE_SPACE)
        put("BACKSPACE", KeyEvent.KEYCODE_DEL)
        put("DELETE", KeyEvent.KEYCODE_FORWARD_DEL)
        put("UP", KeyEvent.KEYCODE_DPAD_UP)
        put("DOWN", KeyEvent.KEYCODE_DPAD_DOWN)
        put("LEFT", KeyEvent.KEYCODE_DPAD_LEFT)
        put("RIGHT", KeyEvent.KEYCODE_DPAD_RIGHT)
        put("HOME", KeyEvent.KEYCODE_MOVE_HOME)
        put("END", KeyEvent.KEYCODE_MOVE_END)
        put("PAGE_UP", KeyEvent.KEYCODE_PAGE_UP)
        put("PAGE_DOWN", KeyEvent.KEYCODE_PAGE_DOWN)
        put("PRINT_SCREEN", KeyEvent.KEYCODE_SYSRQ)
        put("F1", KeyEvent.KEYCODE_F1)
        put("F2", KeyEvent.KEYCODE_F2)
        put("F3", KeyEvent.KEYCODE_F3)
        put("F4", KeyEvent.KEYCODE_F4)
        put("F5", KeyEvent.KEYCODE_F5)
        put("F6", KeyEvent.KEYCODE_F6)
        put("F7", KeyEvent.KEYCODE_F7)
        put("F8", KeyEvent.KEYCODE_F8)
        put("F9", KeyEvent.KEYCODE_F9)
        put("F10", KeyEvent.KEYCODE_F10)
        put("F11", KeyEvent.KEYCODE_F11)
        put("F12", KeyEvent.KEYCODE_F12)
        for (letter in 'A'..'Z') {
            put(letter.toString(), KeyEvent.KEYCODE_A + (letter - 'A'))
        }
        for (digit in '0'..'9') {
            put(digit.toString(), KeyEvent.KEYCODE_0 + (digit - '0'))
        }
    }

    fun toKeyCode(key: String): Int? = KEY_CODES[key.uppercase()]
}
