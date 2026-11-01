package com.yfremote.android.remote

import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

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
     * Holt /ca.crt vom PC ueber HTTP - dort liefert der PC sie bewusst aus (Program.cs, GET /ca.crt), damit
     * man sie vor jedem Vertrauen laden kann. Die Verbindung muss nichts beweisen: angenommen wird die CA
     * nur mit dem Fingerabdruck aus dem QR-Code, den ein Angreifer im WLAN nicht faelschen kann. Danach
     * laeuft jede HTTPS-Verbindung mit normaler Pruefung gegen sie (sslContext). null bei jeder Abweichung.
     * ponytail: HTTP-Port fest 5050 (Server:Port-Standard); ein geaenderter Port scheitert hier, dann
     * muss der QR-Code den Port mitbringen.
     */
    fun fetch(baseUrl: String, expectedSha256: String): X509Certificate? = try {
        val host = URI(baseUrl).host
        val connection = URL("http://$host:${RemoteDevices.DEFAULT_PORT}/ca.crt").openConnection() as HttpURLConnection
        connection.connectTimeout = 3000
        connection.readTimeout = 3000
        val ca = try {
            if (connection.responseCode == 200) parse(connection.inputStream.use { it.readBytes() }) else null
        } finally {
            connection.disconnect()
        }
        ca?.takeIf { sha256(it) == expectedSha256 }
    } catch (e: Exception) {
        null
    }
}
