package com.yfremote.android.bluetooth

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class GamepadReportTest {

    @Test
    fun `neutral state has centered hat and sticks`() {
        assertArrayEquals(byteArrayOf(0, 0, 8, 0, 0, 0, 0, 0, 0), GamepadReport.build(0, 0, 0, 0, 0, 0, 0))
    }

    @Test
    fun `xinput buttons map to hid buttons`() {
        // A (Button 1) und Start (Button 12)
        val report = GamepadReport.build(0x1000 or 0x0010, 0, 0, 0, 0, 0, 0)
        assertEquals(0x01.toByte(), report[0])
        assertEquals(0x08.toByte(), report[1])
    }

    @Test
    fun `dpad becomes hat and opposite directions cancel`() {
        assertEquals(1.toByte(), GamepadReport.build(0x0001 or 0x0008, 0, 0, 0, 0, 0, 0)[2])
        assertEquals(6.toByte(), GamepadReport.build(0x0004, 0, 0, 0, 0, 0, 0)[2])
        assertEquals(8.toByte(), GamepadReport.build(0x0001 or 0x0002, 0, 0, 0, 0, 0, 0)[2])
    }

    @Test
    fun `sticks are scaled and y is inverted`() {
        val report = GamepadReport.build(0, 32767, 32767, -32767, 0, 0, 0)
        assertEquals(127.toByte(), report[3])
        assertEquals((-127).toByte(), report[4])
        assertEquals((-127).toByte(), report[5])
    }

    @Test
    fun `triggers are clamped`() {
        val report = GamepadReport.build(0, 0, 0, 0, 0, 300, -5)
        assertEquals(255.toByte(), report[7])
        assertEquals(0.toByte(), report[8])
    }
}
