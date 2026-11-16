package com.yfremote.android.remote

import org.json.JSONArray
import org.json.JSONObject

/** Ein eigener Button aus dem Web-Client (client/src/app/remote/button-layout.ts,
 *  CustomButtonDefinition): `steps` sind dessen Makro-Schritte, je eine Aktion plus Wartezeit davor. */
data class RemoteButton(val id: String, val label: String, val steps: List<Step>) {
    data class Step(val action: JSONObject, val delayMs: Long)

    companion object {
        // MAX_MACRO_STEPS und MAX_MACRO_DELAY_MS im Web-Client; der PC prueft jede Aktion ohnehin selbst.
        private const val MAX_STEPS = 10
        private const val MAX_DELAY_MS = 5000L

        /** Inhalt von localStorage 'yfremote.buttonLayout' -> nur die eigenen Buttons, als JSON-Array. */
        fun fromLayout(layoutJson: String?): String {
            val custom = runCatching { JSONObject(layoutJson ?: "{}").optJSONArray("customButtons") }.getOrNull()
            return (custom ?: JSONArray()).toString()
        }

        fun parse(json: String?): List<RemoteButton> = runCatching {
            val array = JSONArray(json ?: "[]")
            (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                val stepsJson = item.optJSONArray("steps") ?: JSONArray()
                val steps = (0 until minOf(stepsJson.length(), MAX_STEPS)).mapNotNull { stepIndex ->
                    val step = stepsJson.optJSONObject(stepIndex) ?: return@mapNotNull null
                    val action = step.optJSONObject("action") ?: return@mapNotNull null
                    Step(action, step.optLong("delayMs").coerceIn(0, MAX_DELAY_MS))
                }
                val id = item.optString("id")
                if (id.isEmpty() || steps.isEmpty()) null else RemoteButton(id, item.optString("label").ifEmpty { id }, steps)
            }
        }.getOrDefault(emptyList())
    }
}
