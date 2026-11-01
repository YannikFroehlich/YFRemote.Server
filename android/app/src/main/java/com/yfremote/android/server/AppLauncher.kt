package com.yfremote.android.server

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import java.net.URI

// Android-Aequivalent zu IAppLauncher: nur Apps mit Launcher-Symbol, gestartet wie ein Tipp auf das
// Symbol - nie eine freie Activity oder ein Intent vom Client. Sichtbar ab Android 11 erst durch den
// <queries>-Eintrag im Manifest.
class AppLauncher(private val packageManager: PackageManager) {

    fun listApps(): List<String> = launcherActivities().keys.sortedWith(String.CASE_INSENSITIVE_ORDER)

    // Gestartet aus dem Kontext der Bedienungshilfe: solange das System sie gebunden hat, darf die App
    // trotz der Hintergrund-Startsperre (Android 10+) Activities oeffnen.
    fun launchApp(context: Context, name: String): Boolean {
        val component = launcherActivities().entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value ?: return false
        context.startActivity(
            Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setComponent(component)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED),
        )
        return true
    }

    fun openUrl(context: Context, url: URI) {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.toString())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // Bei gleichem Namen gewinnt die erste Activity, wie bei doppelten Startmenue-Eintraegen am PC.
    private fun launcherActivities(): Map<String, ComponentName> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = linkedMapOf<String, ComponentName>()
        for (info in packageManager.queryIntentActivities(intent, 0)) {
            val label = info.loadLabel(packageManager).toString().trim()
            if (label.isNotEmpty()) apps.putIfAbsent(label, ComponentName(info.activityInfo.packageName, info.activityInfo.name))
        }
        return apps
    }
}

// Wie HandleLaunch in RemoteActionHandler.cs: nur absolute http/https-Adressen bis 2000 Zeichen.
internal fun parseLaunchUrl(url: String): URI? {
    if (url.length > 2000) return null
    val uri = try {
        URI(url.trim())
    } catch (e: Exception) {
        return null
    }
    return uri.takeIf { it.isAbsolute && (it.scheme.equals("http", true) || it.scheme.equals("https", true)) && !it.host.isNullOrEmpty() }
}
