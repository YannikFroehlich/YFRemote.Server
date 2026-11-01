package com.yfremote.android.server

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteActionRouterTest {

    @Test
    fun `nur Medien erlaubt nur Medien- und Lautstaerketasten und den Regler`() {
        assertTrue(isMediaAction("key", listOf("MEDIA_PLAY_PAUSE")))
        assertTrue(isMediaAction("key", listOf("VOLUME_UP")))
        assertTrue(isMediaAction("volume", emptyList()))
        assertTrue(isMediaAction("mediaseek", emptyList()))
        assertFalse(isMediaAction("launch", emptyList()))
        assertTrue(isMediaAction("systemstats", emptyList()))

        assertFalse(isMediaAction("key", listOf("ENTER")))
        assertFalse(isMediaAction("key", listOf("MEDIA_NEXT", "VOLUME_UP")))
        assertFalse(isMediaAction("hotkey", listOf("VOLUME_UP")))
        assertFalse(isMediaAction("text", emptyList()))
        assertFalse(isMediaAction("mouseclick", emptyList()))
        assertFalse(isMediaAction("sleep", emptyList()))
        assertFalse(isMediaAction(null, emptyList()))
    }
}
