package com.yfremote.android.media

import java.io.ByteArrayInputStream
import java.io.InputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaStatusReaderTest {

    @Test
    fun `Position laeuft nur waehrend der Wiedergabe mit der Abspielgeschwindigkeit weiter`() {
        assertEquals(15_000L, currentPositionMs(10_000L, updateTime = 1_000L, speed = 1f, playing = true, now = 6_000L))
        assertEquals(20_000L, currentPositionMs(10_000L, updateTime = 1_000L, speed = 2f, playing = true, now = 6_000L))
        assertEquals(10_000L, currentPositionMs(10_000L, updateTime = 1_000L, speed = 1f, playing = false, now = 6_000L))
        assertEquals(10_000L, currentPositionMs(10_000L, updateTime = 0L, speed = 1f, playing = true, now = 6_000L))
    }

    @Test
    fun `Cover-Adressen nur von content und http`() {
        assertTrue(isLoadableCoverUri("content://media/art/1"))
        assertTrue(isLoadableCoverUri("https://example.com/a.jpg"))
        assertTrue(isLoadableCoverUri("HTTP://example.com/a.jpg"))
        assertFalse(isLoadableCoverUri("file:///data/data/com.yfremote.android/x.png"))
        assertFalse(isLoadableCoverUri("android.resource://x/1"))
        assertFalse(isLoadableCoverUri("kein-schema"))
    }

    @Test
    fun `readAtMost begrenzt und liefert auch stueckweise Daten ganz`() {
        assertEquals(3, readAtMost(ByteArrayInputStream(ByteArray(3)), 3)?.size)
        assertNull(readAtMost(ByteArrayInputStream(ByteArray(4)), 3))
        val stueckweise = object : InputStream() {
            private var rest = 3
            override fun read(): Int = if (rest-- > 0) 7 else -1
            override fun read(b: ByteArray, off: Int, len: Int): Int = if (rest > 0) { rest--; b[off] = 7; 1 } else -1
        }
        assertArrayEquals(byteArrayOf(7, 7, 7), readAtMost(stueckweise, 10))
    }

    @Test
    fun `Sample-Groesse bleibt ueber dem Ziel`() {
        assertEquals(1, coverSampleSize(512, 512))
        assertEquals(1, coverSampleSize(1023, 512))
        assertEquals(2, coverSampleSize(1024, 512))
        assertEquals(32, coverSampleSize(20000, 512))
    }
}
