package com.yfremote.android

import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.Inet4Address
import java.net.InetAddress

class LanAddressTest {

    private fun nic(name: String, address: String) = name to InetAddress.getByName(address) as Inet4Address

    @Test
    fun `active wifi wins over a private cellular address`() {
        val candidates = listOf(nic("rmnet0", "10.20.30.40"), nic("wlan0", "192.168.0.12"))
        assertEquals("192.168.0.12", pickLanAddress(candidates, "wlan0", setOf("rmnet0")))
    }

    @Test
    fun `hotspot address wins while cellular is the active network`() {
        val candidates = listOf(nic("rmnet0", "10.20.30.40"), nic("ap0", "192.168.43.1"))
        assertEquals("192.168.43.1", pickLanAddress(candidates, null, setOf("rmnet0")))
    }

    @Test
    fun `private address wins over a vpn address`() {
        val candidates = listOf(nic("tun0", "100.101.102.103"), nic("wlan0", "192.168.0.12"))
        assertEquals("192.168.0.12", pickLanAddress(candidates, null, emptySet()))
    }
}
