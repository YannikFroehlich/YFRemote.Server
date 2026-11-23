package com.yfremote.android.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DiscoveryTest {

    @Test
    fun `reply round trips the http port`() {
        assertEquals(5050, Discovery.parseReply(String(Discovery.reply(5050), Charsets.UTF_8)))
    }

    @Test
    fun `reply of the pc server is understood`() {
        // So serialisiert NetworkDiscovery.cs mit JsonSerializerOptions.Web.
        assertEquals(5060, Discovery.parseReply("""{"service":"YFRemote","port":5060}"""))
    }

    @Test
    fun `foreign or broken replies are ignored`() {
        assertNull(Discovery.parseReply("""{"service":"Other","port":5050}"""))
        assertNull(Discovery.parseReply("""{"service":"YFRemote","port":0}"""))
        assertNull(Discovery.parseReply("""{"service":"YFRemote","port":70000}"""))
        assertNull(Discovery.parseReply("kein json"))
    }
}
