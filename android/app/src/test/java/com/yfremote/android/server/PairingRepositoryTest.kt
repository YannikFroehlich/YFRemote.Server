package com.yfremote.android.server

import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// Reiner JVM-Test ohne Android-Geraet/Emulator (siehe PLAN.md, "Testing") - PairingRepository
// braucht nur org.json + java.time/java.util, keine Android-Framework-Klasse.
class PairingRepositoryTest {

    private lateinit var tempDir: File
    private lateinit var repository: PairingRepository

    @Before
    fun setUp() {
        tempDir = File.createTempFile("yfremote-pairing-test", "").apply {
            delete()
            mkdirs()
        }
        repository = PairingRepository(tempDir)
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    @Test
    fun `generated PIN is six ASCII digits`() {
        val pin = repository.getCurrentPin().first
        assertEquals(6, pin.length)
        assertTrue(pin.all { it in '0'..'9' })
    }

    @Test
    fun `correct PIN pairs and returns a validatable token`() {
        val pin = repository.getCurrentPin().first
        val response = repository.tryPair(pin, "Test-Handy", "127.0.0.1")

        assertTrue(response.success)
        val token = requireNotNull(response.token)
        assertTrue(repository.isValidToken(token))
    }

    @Test
    fun `wrong PIN is rejected and does not pair`() {
        val response = repository.tryPair("000000", "Test-Handy", "127.0.0.1")

        assertFalse(response.success)
        assertNotNull(response.error)
        assertTrue(repository.getPairedDevices().isEmpty())
    }

    @Test
    fun `used PIN cannot pair a second device`() {
        val pin = repository.getCurrentPin().first
        repository.tryPair(pin, "Erstes Geraet", "127.0.0.1")

        val second = repository.tryPair(pin, "Zweites Geraet", "127.0.0.1")
        assertFalse(second.success)
        assertEquals(1, repository.getPairedDevices().size)
    }

    @Test
    fun `five failed attempts lock out the client IP`() {
        repeat(5) { repository.tryPair("000000", "x", "10.0.0.5") }

        val pin = repository.getCurrentPin().first
        val response = repository.tryPair(pin, "x", "10.0.0.5")

        assertFalse(response.success)
        assertTrue(response.error.orEmpty().contains("Fehlversuche"))
    }

    @Test
    fun `removing a device invalidates its token`() {
        val pin = repository.getCurrentPin().first
        val token = requireNotNull(repository.tryPair(pin, "Test-Handy", "127.0.0.1").token)
        val deviceId = repository.getPairedDevices().single().id

        assertTrue(repository.removeDevice(deviceId))
        assertFalse(repository.isValidToken(token))
    }

    @Test
    fun `devices persist across repository instances`() {
        val pin = repository.getCurrentPin().first
        val token = requireNotNull(repository.tryPair(pin, "Test-Handy", "127.0.0.1").token)

        val reloaded = PairingRepository(tempDir)
        assertTrue(reloaded.isValidToken(token))
    }

    @Test
    fun `invalid or missing token is never valid`() {
        assertFalse(repository.isValidToken(null))
        assertFalse(repository.isValidToken(""))
        assertFalse(repository.isValidToken("not-a-real-token"))
        assertNull(repository.validateToken(null))
    }
}
