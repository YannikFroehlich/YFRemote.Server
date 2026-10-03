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
    fun `qr code yields address and pin`() {
        assertEquals(
            "http://192.168.0.5:5050" to "123456",
            RemoteDevices.parseQrCode("http://192.168.0.5:5050/#pin=123456"),
        )
        assertEquals("http://pc:5060" to null, RemoteDevices.parseQrCode("http://pc:5060/"))
        assertEquals("http://pc:5050" to "654321", RemoteDevices.parseQrCode("https://pc:5443/#pin=654321"))
    }

    @Test
    fun `foreign qr codes are rejected`() {
        for (input in listOf("", "hallo", "WIFI:S:netz;;", "mailto:a@b.de", "ftp://pc/")) {
            assertNull(input, RemoteDevices.parseQrCode(input))
        }
        assertEquals("http://pc:5050" to null, RemoteDevices.parseQrCode("http://pc:5050/#pin=12"))
    }

    @Test
    fun `devices survive serialize and parse`() {
        val devices = listOf(RemoteDevice("http://a:5050", "PC", "00:1A:2B:3C:4D:5E", macWireless = true), RemoteDevice("http://b:5050", "Tablet"))
        assertEquals(devices, RemoteDevices.parse(RemoteDevices.serialize(devices)))
    }

    @Test
    fun `damaged storage yields an empty list`() {
        assertEquals(emptyList<RemoteDevice>(), RemoteDevices.parse("{kaputt"))
    }
}
