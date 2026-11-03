package com.yfremote.android.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateTest {

    private val download = "https://github.com/YannikFroehlich/YFRemote.Server/releases/download/v2.45.0"

    @Test
    fun `latest release yields version and apk asset`() {
        val json = """
            {"tag_name":"v2.45.0","assets":[
              {"name":"YFRemote-win-Setup.exe","browser_download_url":"$download/YFRemote-win-Setup.exe","size":1},
              {"name":"YFRemote-Android-v2.45.0.apk","browser_download_url":"$download/YFRemote-Android-v2.45.0.apk","size":4200}
            ]}
        """

        assertEquals(
            AppRelease("2.45.0", "$download/YFRemote-Android-v2.45.0.apk", 4200),
            parseLatestRelease(json),
        )
    }

    @Test
    fun `release without apk or with a foreign download url yields nothing`() {
        assertNull(parseLatestRelease("""{"tag_name":"v2.45.0","assets":[]}"""))
        assertNull(
            parseLatestRelease(
                """{"tag_name":"v2.45.0","assets":[{"name":"x.apk","browser_download_url":"https://example.com/x.apk"}]}""",
            ),
        )
    }

    @Test
    fun `only a higher release version counts as newer`() {
        assertTrue(isNewerVersion("2.45.0", "2.44.0"))
        assertTrue(isNewerVersion("3.0.0", "2.99.9"))
        assertTrue(isNewerVersion("2.44.10", "2.44.9"))
        assertFalse(isNewerVersion("2.44.0", "2.44.0"))
        assertFalse(isNewerVersion("2.43.0", "2.44.0"))
        assertFalse(isNewerVersion("2.45.0", "0.1-dev"))
        assertFalse(isNewerVersion("", "2.44.0"))
    }
}
