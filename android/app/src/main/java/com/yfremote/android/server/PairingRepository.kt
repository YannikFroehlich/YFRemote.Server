package com.yfremote.android.server

import com.yfremote.android.server.models.PairedDeviceInfo
import com.yfremote.android.server.models.PairResponse
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.Locale
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

// Android-Aequivalent zu Services/PairingService.cs: 6-stellige PIN, SHA-256-gehashte
// Device-Tokens, atomare Persistenz in filesDir/devices.json. Lockouts bleiben bewusst
// in-memory (siehe PLAN.md Stufe 1) - kein pairing-lockouts.json wie im .NET-Server.
class PairingRepository(private val filesDir: File) {

    private data class PairedDevice(
        val id: String,
        val name: String,
        val tokenHash: String,
        val pairedAtUtc: Instant,
        var lastSeenUtc: Instant,
    )

    private data class FailedAttemptState(var count: Int, var lockedUntilUtc: Instant)

    sealed class RemovalResult {
        data class Removed(val deviceId: String) : RemovalResult()
        object NotFound : RemovalResult()
        object PersistenceFailed : RemovalResult()
    }

    companion object {
        private const val PIN_LENGTH = 6
        private const val MAX_FAILED_ATTEMPTS = 5
        private const val MAX_DEVICE_NAME_LENGTH = 60
        private const val DEFAULT_DEVICE_NAME = "Unbekanntes Gerät"
        private val PIN_LIFETIME: Duration = Duration.ofMinutes(10)
        private val LOCKOUT_DURATION: Duration = Duration.ofSeconds(60)
        private val LAST_SEEN_PERSISTENCE_INTERVAL: Duration = Duration.ofMinutes(5)
    }

    private val devicesFile = File(filesDir, "devices.json")
    private val lock = Any()
    private val random = SecureRandom()
    private val devices = mutableListOf<PairedDevice>()
    private val failedAttemptsByIp = mutableMapOf<String, FailedAttemptState>()

    private var pin: String
    private var pinExpiresAtUtc: Instant
    private var nextLastSeenPersistenceUtc: Instant

    init {
        loadDevices()
        val now = Instant.now()
        val generated = generateNewPin(now)
        pin = generated.first
        pinExpiresAtUtc = generated.second
        nextLastSeenPersistenceUtc = now.plus(LAST_SEEN_PERSISTENCE_INTERVAL)
    }

    fun getCurrentPin(): Pair<String, Instant> = synchronized(lock) {
        ensurePinValid(Instant.now())
        pin to pinExpiresAtUtc
    }

    fun regeneratePin(): Pair<String, Instant> = synchronized(lock) {
        val generated = generateNewPin(Instant.now())
        pin = generated.first
        pinExpiresAtUtc = generated.second
        pin to pinExpiresAtUtc
    }

    fun tryPair(requestedPin: String?, requestedDeviceName: String?, clientIp: String): PairResponse {
        val trimmedPin = requestedPin?.trim()
        if (trimmedPin.isNullOrEmpty() || trimmedPin.length != PIN_LENGTH || !trimmedPin.all { it in '0'..'9' }) {
            return PairResponse.fail("PIN muss aus 6 Ziffern bestehen.")
        }

        synchronized(lock) {
            val now = Instant.now()
            val lockedUntil = failedAttemptsByIp[clientIp]?.takeIf {
                it.count >= MAX_FAILED_ATTEMPTS && now.isBefore(it.lockedUntilUtc)
            }?.lockedUntilUtc
            if (lockedUntil != null) {
                val remainingMillis = Duration.between(now, lockedUntil).toMillis()
                val secondsRemaining = maxOf(1L, (remainingMillis + 999) / 1000)
                return PairResponse.fail("Zu viele Fehlversuche. Erneut versuchen in ${secondsRemaining}s.")
            }

            ensurePinValid(now)

            if (trimmedPin != pin) {
                registerFailedAttempt(clientIp, now)
                return PairResponse.fail("PIN ungültig.")
            }

            failedAttemptsByIp.remove(clientIp)

            val token = generateDeviceToken()
            val deviceName = normalizeDeviceName(requestedDeviceName)
            val device = PairedDevice(
                id = UUID.randomUUID().toString(),
                name = deviceName,
                tokenHash = hashToken(token),
                pairedAtUtc = now,
                lastSeenUtc = now,
            )

            devices.add(device)
            if (!persistDevices()) {
                devices.remove(device)
                return PairResponse.fail("Kopplung konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.")
            }

            // Eine erfolgreich verwendete PIN darf kein weiteres Geraet koppeln.
            val generated = generateNewPin(now)
            pin = generated.first
            pinExpiresAtUtc = generated.second
            nextLastSeenPersistenceUtc = now.plus(LAST_SEEN_PERSISTENCE_INTERVAL)

            return PairResponse.ok(token)
        }
    }

    fun isValidToken(token: String?): Boolean = validateToken(token) != null

    /** Gibt die Device-Id zurueck und aktualisiert lastSeenUtc, oder null bei ungueltigem Token. */
    fun validateToken(token: String?): String? {
        if (token.isNullOrEmpty()) return null
        val tokenHash = hashToken(token)

        synchronized(lock) {
            val device = devices.firstOrNull { it.tokenHash == tokenHash } ?: return null
            val now = Instant.now()
            device.lastSeenUtc = now

            if (!now.isBefore(nextLastSeenPersistenceUtc)) {
                persistDevices()
                nextLastSeenPersistenceUtc = now.plus(LAST_SEEN_PERSISTENCE_INTERVAL)
            }

            return device.id
        }
    }

    fun getPairedDevices(): List<PairedDeviceInfo> = synchronized(lock) {
        devices.map { PairedDeviceInfo(it.id, it.name, it.pairedAtUtc.toString(), it.lastSeenUtc.toString()) }
    }

    fun removeDevice(deviceId: String): Boolean = synchronized(lock) {
        val index = devices.indexOfFirst { it.id == deviceId }
        removeDeviceAt(index) is RemovalResult.Removed
    }

    fun removeDeviceByToken(token: String?): RemovalResult {
        if (token.isNullOrEmpty()) return RemovalResult.NotFound
        val tokenHash = hashToken(token)

        synchronized(lock) {
            val index = devices.indexOfFirst { it.tokenHash == tokenHash }
            return removeDeviceAt(index)
        }
    }

    private fun removeDeviceAt(index: Int): RemovalResult {
        if (index < 0) return RemovalResult.NotFound

        val removed = devices.removeAt(index)
        if (!persistDevices()) {
            devices.add(index, removed)
            return RemovalResult.PersistenceFailed
        }

        nextLastSeenPersistenceUtc = Instant.now().plus(LAST_SEEN_PERSISTENCE_INTERVAL)
        return RemovalResult.Removed(removed.id)
    }

    private fun ensurePinValid(now: Instant) {
        if (!now.isBefore(pinExpiresAtUtc)) {
            val generated = generateNewPin(now)
            pin = generated.first
            pinExpiresAtUtc = generated.second
        }
    }

    private fun registerFailedAttempt(clientIp: String, now: Instant) {
        val state = failedAttemptsByIp.getOrPut(clientIp) { FailedAttemptState(0, Instant.MIN) }
        state.count++
        if (state.count >= MAX_FAILED_ATTEMPTS) {
            state.lockedUntilUtc = now.plus(LOCKOUT_DURATION)
        }
    }

    private fun generateNewPin(now: Instant): Pair<String, Instant> {
        val value = random.nextInt(1_000_000)
        // Locale.ROOT statt Default-Locale: manche Locales (z.B. arabisch/persisch) formatieren
        // %d mit anderen Ziffernglyphen - trimmedPin.all { it.isDigit() } bei tryPair() wuerde
        // die dann noch akzeptieren, aber ueber ein Standard-Zifferneingabefeld auf dem
        // koppelnden Geraet waeren sie nicht eintippbar.
        return String.format(Locale.ROOT, "%06d", value) to now.plus(PIN_LIFETIME)
    }

    private fun generateDeviceToken(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun hashToken(token: String): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(token.toByteArray(StandardCharsets.UTF_8))
        return Base64.getEncoder().encodeToString(hash)
    }

    private fun normalizeDeviceName(name: String?): String {
        val trimmed = name?.trim()
        if (trimmed.isNullOrEmpty()) return DEFAULT_DEVICE_NAME
        return if (trimmed.length > MAX_DEVICE_NAME_LENGTH) trimmed.substring(0, MAX_DEVICE_NAME_LENGTH) else trimmed
    }

    private fun loadDevices() {
        if (!devicesFile.exists()) return

        try {
            val json = JSONObject(devicesFile.readText())
            val array = json.optJSONArray("devices") ?: JSONArray()
            for (i in 0 until array.length()) {
                val entry = array.getJSONObject(i)
                devices.add(
                    PairedDevice(
                        id = entry.getString("id"),
                        name = entry.getString("name"),
                        tokenHash = entry.getString("tokenHash"),
                        pairedAtUtc = Instant.parse(entry.getString("pairedAtUtc")),
                        lastSeenUtc = Instant.parse(entry.getString("lastSeenUtc")),
                    ),
                )
            }
        } catch (e: Exception) {
            // Beschaedigte Datei: mit leerer Geraeteliste weitermachen statt abzustuerzen -
            // kein .bak-Recovery wie im .NET-Server (siehe PLAN.md, "Persistenz").
            devices.clear()
        }
    }

    private fun persistDevices(): Boolean {
        return try {
            // Immer schon unter synchronized(lock) aufgerufen (siehe Aufrufer unten).
            val array = JSONArray()
            devices.forEach { device ->
                array.put(
                    JSONObject()
                        .put("id", device.id)
                        .put("name", device.name)
                        .put("tokenHash", device.tokenHash)
                        .put("pairedAtUtc", device.pairedAtUtc.toString())
                        .put("lastSeenUtc", device.lastSeenUtc.toString()),
                )
            }
            val json = JSONObject().put("devices", array)

            filesDir.mkdirs()
            val tempFile = File(filesDir, ".devices.json.${UUID.randomUUID()}.tmp")
            tempFile.writeText(json.toString(), StandardCharsets.UTF_8)
            Files.move(
                tempFile.toPath(),
                devicesFile.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
            true
        } catch (e: Exception) {
            false
        }
    }
}
