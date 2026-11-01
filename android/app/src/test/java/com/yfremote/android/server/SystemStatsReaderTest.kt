package com.yfremote.android.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SystemStatsReaderTest {

    @Test
    fun `Akkustand wird auf Prozent umgerechnet`() {
        assertEquals(87, batteryPercent(87, 100))
        assertEquals(50, batteryPercent(128, 256))
        assertNull(batteryPercent(-1, 100))
        assertNull(batteryPercent(50, 0))
    }
}
