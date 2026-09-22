package com.yfremote.android.server

import android.media.AudioManager
import android.os.SystemClock
import android.view.KeyEvent
import com.yfremote.android.accessibility.YFRemoteAccessibilityService
import com.yfremote.android.ime.KeyEventMap
import com.yfremote.android.ime.YFRemoteInputMethodService
import com.yfremote.android.server.models.RemoteActionRequest
import com.yfremote.android.server.models.RemoteActionResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Android-Aequivalent zu Services/RemoteActionHandler.cs (siehe PLAN.md, Stufen 1-4). Dispatcht
// dieselben Aktionstypen auf AccessibilityService/IME/AudioManager statt IInputService/
// IMouseService/IPowerService - Android braucht keine Interfaces dafuer, es gibt nur eine
// Plattformimplementierung.
//
// Home/Back/Recents haben keine Windows-Entsprechung im Protokoll: WIN->Home, ESC->Back,
// TAB+WIN->Recents (siehe PLAN.md, Stufe 4, "Entschieden").
class RemoteActionRouter(
    private val audioManager: AudioManager,
    private val accessibilityService: () -> YFRemoteAccessibilityService?,
    private val imeService: () -> YFRemoteInputMethodService?,
) {
    companion object {
        private const val MIN_MOUSE_MOVE_DELTA = -5000
        private const val MAX_MOUSE_MOVE_DELTA = 5000
        private const val MIN_MOUSE_SCROLL_DELTA = -1200
        private const val MAX_MOUSE_SCROLL_DELTA = 1200
        private const val MAX_TEXT_LENGTH = 500
        private val VALID_MOUSE_BUTTONS = setOf("left", "right", "middle")
    }

    suspend fun handle(request: RemoteActionRequest?): RemoteActionResponse {
        if (request == null) return fail("Invalid action payload.")

        val type = request.type?.trim()?.lowercase()
        val keys = normalizeKeys(request.keys)

        // AccessibilityService-/IME-Aufrufe muessen auf dem Main-Thread laufen (Android-UI-/
        // Service-APIs sind nicht thread-safe) - Ktor-Routen laufen sonst auf IO-Dispatchern.
        val response = try {
            withContext(Dispatchers.Main) {
                when (type) {
                    "key" -> handleKey(keys)
                    "hotkey" -> handleHotkey(keys)
                    "text" -> handleText(request)
                    "mousemove" -> handleMouseMove(request)
                    "mouseclick" -> handleMouseClick(request)
                    "mousedown" -> handleMouseButton(request, isDown = true)
                    "mouseup" -> handleMouseButton(request, isDown = false)
                    "mousescroll" -> handleMouseScroll(request)
                    "sleep" -> handleSleep()
                    "shutdown", "restart" -> fail("Auf Android ohne Root nicht moeglich.")
                    null, "" -> fail("Missing action type.")
                    else -> fail("Unsupported action type: ${request.type}")
                }
            }
        } catch (e: Exception) {
            fail("Action failed.")
        }

        return response.copy(requestId = request.requestId)
    }

    private fun handleKey(keys: List<String>): RemoteActionResponse {
        if (keys.size != 1) return fail("Action 'key' requires exactly one key.")
        val key = keys[0]

        return when {
            key in KeyEventMap.AUDIO_KEYS -> {
                pressAudioKey(key)
                ok()
            }

            key == "WIN" -> withAccessibility { service ->
                if (service.goHome()) ok() else fail("Aktion nicht moeglich.")
            }

            key == "ESC" -> withAccessibility { service ->
                if (service.goBack()) ok() else fail("Aktion nicht moeglich.")
            }

            else -> withIme { ime ->
                if (ime.sendKey(key)) ok() else fail("Taste nicht unterstuetzt: $key")
            }
        }
    }

    private fun handleHotkey(keys: List<String>): RemoteActionResponse {
        if (keys.size < 2) return fail("Action 'hotkey' requires at least two keys.")
        if (keys.toSet().size != keys.size) return fail("Hotkey keys must be distinct.")

        val keySet = keys.toSet()
        if (keySet == setOf("TAB", "WIN")) {
            return withAccessibility { service ->
                if (service.openRecents()) ok() else fail("Aktion nicht moeglich.")
            }
        }

        return withIme { ime ->
            editorActionFor(keySet)?.let { actionId ->
                return@withIme if (ime.performEditorAction(actionId)) ok() else fail("Aktion im Textfeld nicht moeglich.")
            }
            if (ime.sendHotkeyBestEffort(keys)) ok() else fail("Hotkey wird nicht unterstuetzt (Plattformgrenze).")
        }
    }

    private fun editorActionFor(keys: Set<String>): Int? = when (keys) {
        setOf("CTRL", "A") -> android.R.id.selectAll
        setOf("CTRL", "C") -> android.R.id.copy
        setOf("CTRL", "X") -> android.R.id.cut
        setOf("CTRL", "V") -> android.R.id.paste
        setOf("CTRL", "Z") -> android.R.id.undo
        else -> null
    }

    private fun handleText(request: RemoteActionRequest): RemoteActionResponse {
        val text = request.text
        if (text.isNullOrEmpty()) return fail("Action 'text' requires text.")
        if (text.length > MAX_TEXT_LENGTH) return fail("text must be at most $MAX_TEXT_LENGTH characters.")

        return withIme { ime ->
            if (ime.commitText(text)) ok() else fail("Kein fokussiertes Textfeld.")
        }
    }

    private fun handleMouseMove(request: RemoteActionRequest): RemoteActionResponse {
        val deltaX = request.deltaX
        val deltaY = request.deltaY
        if (deltaX == null || deltaY == null) return fail("Action 'mouseMove' requires deltaX and deltaY.")
        if (!isInRange(deltaX, MIN_MOUSE_MOVE_DELTA, MAX_MOUSE_MOVE_DELTA)) {
            return fail("deltaX must be between $MIN_MOUSE_MOVE_DELTA and $MAX_MOUSE_MOVE_DELTA.")
        }
        if (!isInRange(deltaY, MIN_MOUSE_MOVE_DELTA, MAX_MOUSE_MOVE_DELTA)) {
            return fail("deltaY must be between $MIN_MOUSE_MOVE_DELTA and $MAX_MOUSE_MOVE_DELTA.")
        }

        return withAccessibility { service ->
            service.moveCursor(deltaX, deltaY)
            ok()
        }
    }

    private fun handleMouseClick(request: RemoteActionRequest): RemoteActionResponse {
        val button = request.button?.trim()?.lowercase()
        if (button.isNullOrBlank()) return fail("Action 'mouseClick' requires button.")

        return withAccessibility { service ->
            when (button) {
                "left" -> {
                    service.tap()
                    ok()
                }

                "right" -> {
                    service.longPress()
                    ok()
                }

                "middle" -> fail("Mittlere Maustaste hat keine Android-Entsprechung.")
                else -> fail("Unsupported mouse button: ${request.button}")
            }
        }
    }

    private fun handleMouseButton(request: RemoteActionRequest, isDown: Boolean): RemoteActionResponse {
        val actionName = if (isDown) "mouseDown" else "mouseUp"
        val button = request.button?.trim()?.lowercase()
        if (button.isNullOrBlank()) return fail("Action '$actionName' requires button.")
        if (button !in VALID_MOUSE_BUTTONS) return fail("Unsupported mouse button: ${request.button}")

        return withAccessibility { service ->
            if (isDown) service.mouseDown() else service.mouseUp()
            ok()
        }
    }

    private fun handleMouseScroll(request: RemoteActionRequest): RemoteActionResponse {
        if (request.delta == null && request.deltaX == null) return fail("Action 'mouseScroll' requires delta or deltaX.")
        request.delta?.let {
            if (!isInRange(it, MIN_MOUSE_SCROLL_DELTA, MAX_MOUSE_SCROLL_DELTA)) {
                return fail("delta must be between $MIN_MOUSE_SCROLL_DELTA and $MAX_MOUSE_SCROLL_DELTA.")
            }
        }
        request.deltaX?.let {
            if (!isInRange(it, MIN_MOUSE_SCROLL_DELTA, MAX_MOUSE_SCROLL_DELTA)) {
                return fail("deltaX must be between $MIN_MOUSE_SCROLL_DELTA and $MAX_MOUSE_SCROLL_DELTA.")
            }
        }

        return withAccessibility { service ->
            service.scroll(deltaX = request.deltaX, deltaY = request.delta)
            ok()
        }
    }

    private fun handleSleep(): RemoteActionResponse = withAccessibility { service ->
        if (service.lockScreen()) ok() else fail("Sperren wird auf dieser Android-Version nicht unterstuetzt (ab API 28).")
    }

    private fun pressAudioKey(key: String) {
        when (key) {
            "VOLUME_UP" -> audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
            "VOLUME_DOWN" -> audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
            "VOLUME_MUTE" -> audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI)
            "MEDIA_PLAY_PAUSE" -> dispatchMediaKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            "MEDIA_NEXT" -> dispatchMediaKey(KeyEvent.KEYCODE_MEDIA_NEXT)
            "MEDIA_PREVIOUS" -> dispatchMediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            "MEDIA_STOP" -> dispatchMediaKey(KeyEvent.KEYCODE_MEDIA_STOP)
        }
    }

    private fun dispatchMediaKey(keyCode: Int) {
        val now = SystemClock.uptimeMillis()
        audioManager.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0))
        audioManager.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0))
    }

    private inline fun withAccessibility(action: (YFRemoteAccessibilityService) -> RemoteActionResponse): RemoteActionResponse {
        val service = accessibilityService() ?: return fail("Bedienungshilfe 'YFRemote' ist nicht aktiv.")
        return action(service)
    }

    private inline fun withIme(action: (YFRemoteInputMethodService) -> RemoteActionResponse): RemoteActionResponse {
        val ime = imeService() ?: return fail("Tastatur 'YFRemote' ist nicht aktiv.")
        return action(ime)
    }

    private fun normalizeKeys(keys: List<String>?): List<String> {
        if (keys == null) return emptyList()
        return keys.mapNotNull { key -> key.trim().takeIf { it.isNotEmpty() }?.uppercase() }
    }

    private fun isInRange(value: Int, min: Int, max: Int) = value in min..max

    private fun ok() = RemoteActionResponse.ok()

    private fun fail(error: String) = RemoteActionResponse.fail(error)
}
