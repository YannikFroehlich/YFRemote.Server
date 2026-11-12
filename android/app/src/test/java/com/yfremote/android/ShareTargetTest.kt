package com.yfremote.android

import com.yfremote.android.remote.RemoteClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShareTargetTest {

    @Test
    fun `a shared link alone is opened on the pc`() {
        assertEquals("https://youtu.be/abc?t=5", sharedUrl("  https://youtu.be/abc?t=5\n"))
        assertEquals("http://192.168.0.5:8080/x", sharedUrl("http://192.168.0.5:8080/x"))
    }

    @Test
    fun `other text goes to the clipboard`() {
        for (text in listOf("Schau mal https://example.com", "hallo", "ftp://host/file", "https://", "https://" + "a".repeat(2000))) {
            assertNull(text, sharedUrl(text))
        }
    }

    @Test
    fun `rejections map to their hints`() {
        assertEquals(RemoteClient.Result.NotPaired, RemoteClient.failure(401, null))
        assertEquals(RemoteClient.Result.TooLarge, RemoteClient.failure(413, """{"success":false,"error":"File is too large."}"""))
        assertEquals(RemoteClient.Result.MediaOnly, RemoteClient.failure(403, "Not allowed for this device."))
        assertEquals(RemoteClient.Result.Failed(null), RemoteClient.failure(403, "Origin not allowed."))
        assertEquals(RemoteClient.Result.Failed("No file was sent."), RemoteClient.failure(400, """{"success":false,"error":"No file was sent."}"""))
    }
}
