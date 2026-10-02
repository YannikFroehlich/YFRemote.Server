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
        assertEquals(listOf("192.168.0.12"), lanAddresses(candidates, "wlan0", setOf("rmnet0")))
    }

    @Test
    fun `hotspot address wins while cellular is the active network`() {
        val candidates = listOf(nic("rmnet0", "10.20.30.40"), nic("ap0", "192.168.43.1"))
        assertEquals(listOf("192.168.43.1"), lanAddresses(candidates, null, setOf("rmnet0")))
    }

    @Test
    fun `private address wins over a vpn address`() {
        val candidates = listOf(nic("tun0", "100.101.102.103"), nic("wlan0", "192.168.0.12"))
        assertEquals(listOf("192.168.0.12"), lanAddresses(candidates, null, emptySet()))
    }

    @Test
    fun `hotspot next to active wifi is listed after it`() {
        val candidates = listOf(nic("swlan0", "10.93.70.108"), nic("rmnet0", "10.20.30.40"), nic("wlan0", "192.168.178.167"))
        assertEquals(listOf("192.168.178.167", "10.93.70.108"), lanAddresses(candidates, "wlan0", setOf("rmnet0")))
    }

    @Test
    fun `cellular-only phone still shows its address`() {
        assertEquals(listOf("100.86.144.83"), lanAddresses(listOf(nic("rmnet_data0", "100.86.144.83")), null, setOf("rmnet_data0")))
    }
}
