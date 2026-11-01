package com.yfremote.android.remote

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Feste Testzertifikate (openssl, P-256, 100 Jahre gueltig): eine CA, ein von ihr ausgestelltes
// Server-Zertifikat fuer 192.168.0.5 und eine fremde CA.
class PinnedCaTest {

    private val ca = cert("MIIBjjCCATOgAwIBAgIUJPTwoKJPs1vZEysEHU0Gih/oTG8wCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWUZSZW1vdGUgVGVzdCBDQTAgFw0yNjExMDEwODU5MzJaGA8yMTI2MTAwODA4NTkzMlowGzEZMBcGA1UEAwwQWUZSZW1vdGUgVGVzdCBDQTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABF9NvURxaYl4YDlLX4tndlD9Lzb3mA6FNX0wXMAlOwwfppQZHyKk7zdqouzyoIQH10rF+/Lx1tEBO0Pgq661wU2jUzBRMB0GA1UdDgQWBBTrefNKMUi3CAIa6Ak8Z8GbcLUGpjAfBgNVHSMEGDAWgBTrefNKMUi3CAIa6Ak8Z8GbcLUGpjAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQCrjK7SnCndJRxNRINtD/e1jUr8dnVLgA9uVNh3KN6OsgIhAMkzfSx2a0IS+0adIustf1vuEo1/AbwiDPZRyg+qqW6O")
    private val other = cert("MIIBfjCCASWgAwIBAgIUQ5E5HM2pl4x5jyB5U/NuQnfSrk8wCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJRnJlbWRlIENBMCAXDTI2MTEwMTA4NTkzMloYDzIxMjYxMDA4MDg1OTMyWjAUMRIwEAYDVQQDDAlGcmVtZGUgQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASBG1YpDLojsKDO5XeGYca6zNonWgThl5Xoz27gRrNKm1q8ScLR3PkuoOi6f263t2pWT91F+QlHAUJQZ7ulCGp+o1MwUTAdBgNVHQ4EFgQU5OGdyAHjA/uaqjwHVKes+3H7SocwHwYDVR0jBBgwFoAU5OGdyAHjA/uaqjwHVKes+3H7SocwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiBVEP75mKVrACJkq8bt1Mu4EvKizY5tZxC2WEMk/31zfQIgeBnV15g2N0hqo2sfvzTwsIR3Z9STo46QmYu9e4z1rSU=")
    private val leaf = cert("MIIBiTCCAS6gAwIBAgIUbpPTWIH55WbyHlS0vLxr36eiboowCgYIKoZIzj0EAwIwGzEZMBcGA1UEAwwQWUZSZW1vdGUgVGVzdCBDQTAgFw0yNjExMDEwODU5MzJaGA8yMTI2MTAwODA4NTkzMlowFjEUMBIGA1UEAwwLMTkyLjE2OC4wLjUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQa85wZwnstWrjlc1Vt1Mj18wr089Ab/+5x5AGz4IUwqXi/nr/PKi9ewkpMNXCtM+gufkcGBvt4niIbjFTv4aVMo1MwUTAPBgNVHREECDAGhwTAqAAFMB0GA1UdDgQWBBQrjHkdBA/2ndrLWmV2tSU3zVOHYzAfBgNVHSMEGDAWgBTrefNKMUi3CAIa6Ak8Z8GbcLUGpjAKBggqhkjOPQQDAgNJADBGAiEA04l2mjwsVgdngLGcD15POkP5tRQ2Z54yv8jdLegXgRQCIQCunnyjkVU/EG0bHeqkGKu/OMa7sIh0tl/p5dvqkdcXbA==")

    @Test
    fun `nur ein Zertifikat der gepinnten CA wird angenommen`() {
        assertTrue(PinnedCa.issued(leaf, ca))
        assertFalse(PinnedCa.issued(leaf, other))
        assertFalse(PinnedCa.issued(other, ca))
    }

    @Test
    fun `Fingerabdruck ist SHA-256 ueber DER in Kleinbuchstaben`() {
        assertEquals("66346c95683bf635ad7de792464bd1dba228f71368b4b061a29efaa8f4d947e0", PinnedCa.sha256(ca))
    }

    private fun cert(base64: String) = PinnedCa.parse(Base64.getDecoder().decode(base64))
}
