package com.yfremote.android.remote

import java.io.ByteArrayInputStream
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

// HTTPS zu einem PC mit "HTTPS verwenden": Vertraut wird genau seiner lokalen CA (LocalCertificateAuthority),
// deren SHA-256-Fingerabdruck der QR-Code vom PC-Bildschirm mitbringt - nie einer beliebigen.
object PinnedCa {

    fun parse(der: ByteArray): X509Certificate =
        CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate

    fun sha256(certificate: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString("") { "%02x".format(it) }

    /** Von dieser CA signiert und gerade gueltig - die Pruefung, die das WebView ohne die CA nicht kann. */
    fun issued(leaf: X509Certificate, ca: X509Certificate): Boolean = try {
        leaf.verify(ca.publicKey)
        leaf.checkValidity()
        true
    } catch (e: Exception) {
        false
    }

    /** Normale TLS-Pruefung (Kette, Gueltigkeit, Hostname), aber mit dieser CA als einzigem Anker. */
    fun sslContext(ca: X509Certificate): SSLContext {
        val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setCertificateEntry("yfremote-ca", ca)
        }
        val trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
        return SSLContext.getInstance("TLS").apply { init(null, trust.trustManagers, null) }
    }

    /**
     * Holt /ca.crt vom PC. Dem Server vertraut zu dem Zeitpunkt noch nichts, deshalb zaehlt das Ergebnis
     * nur, wenn die CA den Fingerabdruck aus dem QR-Code hat und das Zertifikat dieser Verbindung von ihr
     * stammt - ein Angreifer im WLAN kann beides nicht faelschen. null bei jeder Abweichung.
     */
    fun fetch(baseUrl: String, expectedSha256: String): X509Certificate? = try {
        val capture = LeafCapture()
        val connection = URL("$baseUrl/ca.crt").openConnection() as HttpsURLConnection
        connection.sslSocketFactory = SSLContext.getInstance("TLS").apply { init(null, arrayOf(capture), null) }.socketFactory
        // Der Hostname zaehlt hier nicht: entscheidend ist, dass das Server-Zertifikat von der gepinnten CA stammt.
        connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
        connection.connectTimeout = 3000
        connection.readTimeout = 3000
        val ca = try {
            if (connection.responseCode == 200) parse(connection.inputStream.use { it.readBytes() }) else null
        } finally {
            connection.disconnect()
        }
        val leaf = capture.leaf
        ca?.takeIf { sha256(it) == expectedSha256 && leaf != null && issued(leaf, it) }
    } catch (e: Exception) {
        null
    }

    // Nimmt jedes Zertifikat an und merkt sich das des Servers - fetch prueft es danach gegen die CA.
    private class LeafCapture : X509TrustManager {
        @Volatile
        var leaf: X509Certificate? = null

        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
            leaf = chain.firstOrNull()
        }

        override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) = Unit

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}
