package com.yfremote.android.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteButtonTest {

    @Test
    fun customButtonsComeFromTheStoredLayout() {
        val layout = """
            {"version":1,"placements":[],"hiddenBuiltInIds":[],"customButtons":[
              {"id":"custom:lock","label":"Sperren","icon":null,"steps":[{"action":{"type":"lock"},"delayMs":0}]},
              {"id":"custom:macro","label":"Makro","steps":[
                {"action":{"type":"key","key":"F5"},"delayMs":0},
                {"action":{"type":"text","text":"hallo"},"delayMs":99999}]},
              {"id":"custom:empty","label":"Leer","steps":[]}
            ]}
        """.trimIndent()

        val buttons = RemoteButton.parse(RemoteButton.fromLayout(layout))

        assertEquals(listOf("custom:lock", "custom:macro"), buttons.map { it.id })
        assertEquals("lock", buttons[0].steps.single().action.getString("type"))
        assertEquals(listOf(0L, 5000L), buttons[1].steps.map { it.delayMs })
    }

    @Test
    fun missingOrBrokenLayoutGivesNoButtons() {
        assertTrue(RemoteButton.parse(RemoteButton.fromLayout(null)).isEmpty())
        assertTrue(RemoteButton.parse(RemoteButton.fromLayout("kein json")).isEmpty())
        assertTrue(RemoteButton.parse("kaputt").isEmpty())
    }
}
