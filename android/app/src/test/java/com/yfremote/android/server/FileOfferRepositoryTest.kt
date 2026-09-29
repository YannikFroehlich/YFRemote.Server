package com.yfremote.android.server

import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class FileOfferRepositoryTest {

    private lateinit var tempDir: File
    private var now = 0L
    private lateinit var repository: FileOfferRepository

    @Before
    fun setUp() {
        tempDir = File.createTempFile("yfremote-offer-test", "").apply {
            delete()
            mkdirs()
        }
        repository = FileOfferRepository(File(tempDir, "offers")) { now }
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    @Test
    fun `offer is served by its id and announced`() {
        var announced: String? = null
        repository.onOffered = { announced = it.id }

        val offer = repository.offer("bericht.pdf", "Inhalt".byteInputStream())

        assertEquals(offer.id, announced)
        assertEquals("fileOffer", offer.type)
        assertEquals(7L, offer.size)
        assertEquals("Inhalt", repository.fileFor(offer.id)?.readText())
        assertNull(repository.fileFor("andere-id"))
    }

    @Test
    fun `new offer replaces and deletes the old one`() {
        val first = repository.offer("a.txt", "a".byteInputStream())
        val firstFile = repository.fileFor(first.id)!!

        val second = repository.offer("b.txt", "b".byteInputStream())

        assertNull(repository.fileFor(first.id))
        assertFalse(firstFile.exists())
        assertEquals(second, repository.currentOffer)
    }

    @Test
    fun `offer expires after ten minutes`() {
        val offer = repository.offer("a.txt", "a".byteInputStream())

        now += FileOfferRepository.LIFETIME_MILLIS

        assertNull(repository.currentOffer)
        assertNull(repository.fileFor(offer.id))
    }

    @Test
    fun `path traversal in the shared name stays inside the offers folder`() {
        for (name in listOf("../../evil.txt", "..", ".")) {
            val offer = repository.offer(name, "x".byteInputStream())
            assertEquals(File(tempDir, "offers").canonicalPath, repository.fileFor(offer.id)!!.parentFile!!.canonicalPath)
        }
    }
}
