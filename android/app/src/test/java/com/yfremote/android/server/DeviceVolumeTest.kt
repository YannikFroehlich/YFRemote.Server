package com.yfremote.android.server

import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceVolumeTest {

    @Test
    fun `Prozent und Stufen werden gerundet umgerechnet`() {
        assertEquals(0, DeviceVolume.toIndex(0, 15))
        assertEquals(8, DeviceVolume.toIndex(50, 15))
        assertEquals(15, DeviceVolume.toIndex(100, 15))

        assertEquals(53, DeviceVolume.toPercent(8, 15))
        assertEquals(100, DeviceVolume.toPercent(15, 15))
        assertEquals(0, DeviceVolume.toPercent(3, 0))
    }
}
