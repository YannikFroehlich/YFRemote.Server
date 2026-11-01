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
            QrCode("http://192.168.0.5:5050", "123456"),
            RemoteDevices.parseQrCode("http://192.168.0.5:5050/#pin=123456"),
        )
        assertEquals(QrCode("http://pc:5060", null), RemoteDevices.parseQrCode("http://pc:5060/"))
        assertEquals(QrCode("http://pc:5050", "654321"), RemoteDevices.parseQrCode("https://pc:5443/#pin=654321"))
    }

    @Test
    fun `https qr code with ca fingerprint stays on https`() {
        val fingerprint = "0123456789abcdef".repeat(4)
        assertEquals(
            QrCode("https://192.168.0.5:5443", "123456", fingerprint),
            RemoteDevices.parseQrCode("https://192.168.0.5:5443/#pin=123456&ca=$fingerprint"),
        )
        assertEquals(QrCode("https://pc:5443", null, fingerprint), RemoteDevices.parseQrCode("https://pc:5443/#ca=$fingerprint"))
        // Kein gueltiger Fingerabdruck: wie ein HTTPS-QR ohne, also HTTP.
        assertEquals(QrCode("http://pc:5050", null), RemoteDevices.parseQrCode("https://pc:5443/#ca=ABC"))
    }

    @Test
    fun `foreign qr codes are rejected`() {
        for (input in listOf("", "hallo", "WIFI:S:netz;;", "mailto:a@b.de", "ftp://pc/")) {
            assertNull(input, RemoteDevices.parseQrCode(input))
        }
        assertEquals(QrCode("http://pc:5050", null), RemoteDevices.parseQrCode("http://pc:5050/#pin=12"))
    }

    @Test
    fun `devices survive serialize and parse`() {
        val devices = listOf(
            RemoteDevice("http://a:5050", "PC", "00:1A:2B:3C:4D:5E", macWireless = true),
            RemoteDevice("http://b:5050", "Tablet"),
            RemoteDevice("https://c:5443", "Laptop", ca = "MIIB"),
        )
        assertEquals(devices, RemoteDevices.parse(RemoteDevices.serialize(devices)))
    }

    @Test
    fun `older entries count as named only when the name differs from the address`() {
        val stored = """[{"url":"http://a:5050","name":"a:5050"},{"url":"http://b:5050","name":"Wohnzimmer"}]"""
        assertEquals(listOf(false, true), RemoteDevices.parse(stored).map { it.named })
    }

    @Test
    fun `address and https are derived from the url`() {
        val device = RemoteDevice("https://192.168.0.5:5443", "Gaming-PC")
        assertEquals("192.168.0.5:5443", device.address)
        assertEquals(true, device.secure)
        assertEquals(false, RemoteDevice("http://pc:5050", "PC").secure)
    }

    @Test
    fun `damaged storage yields an empty list`() {
        assertEquals(emptyList<RemoteDevice>(), RemoteDevices.parse("{kaputt"))
    }
}
