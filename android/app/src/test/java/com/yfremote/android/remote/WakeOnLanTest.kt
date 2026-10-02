package com.yfremote.android.remote

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WakeOnLanTest {

    @Test
    fun `magic packet is six 0xFF bytes followed by the mac sixteen times`() {
        val packet = WakeOnLan.packet("00:1A:2B:3C:4D:5E")!!
        val mac = byteArrayOf(0x00, 0x1A, 0x2B, 0x3C, 0x4D, 0x5E)

        assertEquals(102, packet.size)
        assertArrayEquals(ByteArray(6) { 0xFF.toByte() }, packet.copyOfRange(0, 6))
        for (repeat in 0 until 16) {
            assertArrayEquals(mac, packet.copyOfRange(6 + repeat * 6, 12 + repeat * 6))
        }
    }

    @Test
    fun `dash separated mac is accepted`() {
        assertArrayEquals(WakeOnLan.packet("00:1A:2B:3C:4D:5E"), WakeOnLan.packet("00-1a-2b-3c-4d-5e"))
    }

    @Test
    fun `invalid macs are rejected`() {
        assertNull(WakeOnLan.packet(""))
        assertNull(WakeOnLan.packet("00:1A:2B:3C:4D"))
        assertNull(WakeOnLan.packet("00:1A:2B:3C:4D:ZZ"))
        assertNull(WakeOnLan.packet("+0:1A:2B:3C:4D:5E"))
    }
}
