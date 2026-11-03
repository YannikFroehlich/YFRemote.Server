package com.yfremote.android.update

import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

// Selbst-Update fuer die per APK installierte App - Velopack (UpdateService unter Windows) gibt es
// fuer Android nicht. Quelle ist dasselbe GitHub-Release, an das release-android die APK haengt.
private const val LATEST_RELEASE_URL =
    "https://api.github.com/repos/YannikFroehlich/YFRemote.Server/releases/latest"
private const val DOWNLOAD_PREFIX =
    "https://github.com/YannikFroehlich/YFRemote.Server/releases/download/"

internal data class AppRelease(val version: String, val apkUrl: String, val size: Long)

/** Version und APK aus der Antwort von releases/latest; null ohne APK, denn release-android haengt
 *  sie erst nach dem Windows-Release an. */
internal fun parseLatestRelease(json: String): AppRelease? {
    val release = JSONObject(json)
    val assets = release.optJSONArray("assets") ?: return null
    for (index in 0 until assets.length()) {
        val asset = assets.getJSONObject(index)
        val url = asset.optString("browser_download_url")
        if (asset.optString("name").endsWith(".apk") && url.startsWith(DOWNLOAD_PREFIX)) {
            return AppRelease(release.optString("tag_name").removePrefix("v"), url, asset.optLong("size"))
        }
    }
    return null
}

/** Nur x.y.z gegen x.y.z: ein Dev-Build ("0.1-dev") bekommt nie ein Update, die Release-APK ist
 *  anders signiert und liesse sich gar nicht darueber installieren. */
internal fun isNewerVersion(latest: String, current: String): Boolean {
    fun parts(version: String): List<Int>? =
        version.split('.').map { it.toIntOrNull() ?: return null }.takeIf { it.size == 3 }

    val new = parts(latest) ?: return false
    val old = parts(current) ?: return false
    for (index in 0..2) {
        if (new[index] != old[index]) return new[index] > old[index]
    }
    return false
}

/** Netzwerk - nicht auf dem Main-Thread aufrufen. */
internal fun fetchLatestRelease(): AppRelease? =
    (URL(LATEST_RELEASE_URL).openConnection() as HttpURLConnection).run {
        connectTimeout = 10_000
        readTimeout = 10_000
        setRequestProperty("Accept", "application/vnd.github+json")
        try {
            if (responseCode == 200) parseLatestRelease(inputStream.bufferedReader().use { it.readText() }) else null
        } finally {
            disconnect()
        }
    }

/** Laedt die APK direkt in eine PackageInstaller-Session und schickt sie ab; das Ergebnis kommt an
 *  [status]. Ab Android 12 darf Android ohne Rueckfrage aktualisieren, wenn YFRemote selbst als
 *  Installationsquelle eingetragen ist - sonst fragt es (STATUS_PENDING_USER_ACTION). Die Signatur
 *  prueft Android: nur eine APK mit demselben Schluessel ersetzt die installierte App.
 *  Netzwerk - nicht auf dem Main-Thread aufrufen. */
internal fun installRelease(context: Context, release: AppRelease, status: PendingIntent) {
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
        setAppPackageName(context.packageName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
    }
    installer.openSession(installer.createSession(params)).use { session ->
        try {
            (URL(release.apkUrl).openConnection() as HttpURLConnection).run {
                connectTimeout = 10_000
                readTimeout = 30_000
                try {
                    if (responseCode != 200) throw IOException("HTTP $responseCode")
                    session.openWrite("YFRemote.apk", 0, if (release.size > 0) release.size else -1).use { out ->
                        inputStream.use { it.copyTo(out) }
                        session.fsync(out)
                    }
                } finally {
                    disconnect()
                }
            }
            session.commit(status.intentSender)
        } catch (e: Exception) {
            session.abandon()
            throw e
        }
    }
}
