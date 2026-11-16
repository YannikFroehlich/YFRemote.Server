package com.yfremote.android.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class RingListenerServiceTest {

    @Test
    fun `retry waits briefly after a dropped connection and backs off up to a minute`() {
        assertEquals(
            listOf(2_000L, 5_000L, 10_000L, 20_000L, 40_000L, 60_000L, 60_000L, 60_000L),
            (0..7).map { RingListenerService.retryDelayMs(it) },
        )
    }
}
