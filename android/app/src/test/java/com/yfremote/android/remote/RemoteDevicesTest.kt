package com.yfremote.android.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteDevicesTest {

    @Test
    fun `address without port gets the default port`() {
        assertEquals("http://192.168.0.10:5050", RemoteDevices.normalizeAddress(" 192.168.0.10 "))
    }

    @Test
    fun `address keeps an explicit port and drops http prefix`() {
        assertEquals("http://pc.local:5060", RemoteDevices.normalizeAddress("http://pc.local:5060/"))
    }

    @Test
    fun `invalid addresses are rejected`() {
        for (input in listOf("", "https://pc:5443", "pc:abc", "pc:0", "pc:70000", "pc/pfad", "p c", ":5050")) {
            assertNull(input, RemoteDevices.normalizeAddress(input))
        }
    }

    @Test
    fun `devices survive serialize and parse`() {
        val devices = listOf(RemoteDevice("http://a:5050", "PC"), RemoteDevice("http://b:5050", "Tablet"))
        assertEquals(devices, RemoteDevices.parse(RemoteDevices.serialize(devices)))
    }

    @Test
    fun `damaged storage yields an empty list`() {
        assertEquals(emptyList<RemoteDevice>(), RemoteDevices.parse("{kaputt"))
    }
}
