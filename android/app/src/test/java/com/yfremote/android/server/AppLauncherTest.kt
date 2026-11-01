package com.yfremote.android.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppLauncherTest {

    @Test
    fun `nur absolute http- und https-Adressen werden geoeffnet`() {
        assertEquals("https://www.youtube.com/watch?v=1", parseLaunchUrl(" https://www.youtube.com/watch?v=1 ").toString())
        assertEquals("http://192.168.178.2:8080/", parseLaunchUrl("http://192.168.178.2:8080/").toString())

        assertNull(parseLaunchUrl("intent://scan/#Intent;scheme=zxing;end"))
        assertNull(parseLaunchUrl("file:///sdcard/Download/x.apk"))
        assertNull(parseLaunchUrl("javascript:alert(1)"))
        assertNull(parseLaunchUrl("www.youtube.com"))
        assertNull(parseLaunchUrl("https://"))
        assertNull(parseLaunchUrl("https://example.com/" + "a".repeat(2000)))
    }
}
