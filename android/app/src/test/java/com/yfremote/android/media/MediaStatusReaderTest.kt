package com.yfremote.android.media

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaStatusReaderTest {

    @Test
    fun `Position laeuft nur waehrend der Wiedergabe mit der Abspielgeschwindigkeit weiter`() {
        assertEquals(15_000L, currentPositionMs(10_000L, updateTime = 1_000L, speed = 1f, playing = true, now = 6_000L))
        assertEquals(20_000L, currentPositionMs(10_000L, updateTime = 1_000L, speed = 2f, playing = true, now = 6_000L))
        assertEquals(10_000L, currentPositionMs(10_000L, updateTime = 1_000L, speed = 1f, playing = false, now = 6_000L))
        assertEquals(10_000L, currentPositionMs(10_000L, updateTime = 0L, speed = 1f, playing = true, now = 6_000L))
    }
}
