package com.yfremote.android

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.yfremote.android.accessibility.YFRemoteAccessibilityService
import com.yfremote.android.ime.YFRemoteInputMethodService
import com.yfremote.android.server.KtorServer
import com.yfremote.android.service.YFRemoteForegroundService
import java.net.Inet4Address
import java.net.NetworkInterface

// Android-Aequivalent zu TrayApplicationContext (Windows) - PIN-Anzeige, gekoppelte Geraete,
// Links zu den zwei manuell zu erteilenden Berechtigungen, Start/Stopp fuer den Dienst (siehe
// PLAN.md, Stufe 5). Bewusst ohne AndroidX-UI-Toolkit (RecyclerView etc.) - programmatisch
// gebaute Views, gleicher Stil wie schon in Stufe 0.
class SetupActivity : Activity() {

    private lateinit var addressText: TextView
    private lateinit var pinText: TextView
    private lateinit var toggleButton: Button
    private lateinit var accessibilityStatusText: TextView
    private lateinit var keyboardStatusText: TextView
    private lateinit var devicesContainer: LinearLayout

    private val refreshHandler = Handler(Looper.getMainLooper())
    private val refreshRunnable = object : Runnable {
        override fun run() {
            refreshUi()
            refreshHandler.postDelayed(this, 2000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        setContentView(buildLayout())
        ensureServiceRunning()
    }

    override fun onResume() {
        super.onResume()
        refreshHandler.post(refreshRunnable)
    }

    override fun onPause() {
        refreshHandler.removeCallbacks(refreshRunnable)
        super.onPause()
    }

    private fun buildLayout(): ScrollView {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        addressText = TextView(this).apply { textSize = 16f }
        root.addView(addressText)

        pinText = TextView(this).apply {
            textSize = 28f
            setPadding(0, dp(16), 0, dp(8))
        }
        root.addView(pinText)

        root.addView(
            Button(this).apply {
                text = "PIN neu erzeugen"
                setOnClickListener {
                    YFRemoteForegroundService.instance?.let {
                        it.pairing.regeneratePin()
                        it.refreshNotification()
                    }
                    refreshUi()
                }
            },
        )

        toggleButton = Button(this).apply { setOnClickListener { toggleService() } }
        root.addView(toggleButton)

        root.addView(sectionLabel("Berechtigungen", dp(24)))

        accessibilityStatusText = TextView(this).apply { textSize = 16f }
        root.addView(accessibilityStatusText)
        root.addView(
            Button(this).apply {
                text = "Bedienungshilfe aktivieren"
                setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            },
        )

        keyboardStatusText = TextView(this).apply { textSize = 16f }
        root.addView(keyboardStatusText)
        root.addView(
            Button(this).apply {
                text = "Tastatur aktivieren"
                setOnClickListener { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) }
            },
        )

        // Haeufigster Grund fuer eine dauerhaft inaktive Bedienungshilfe: die App wurde per APK
        // installiert, dann sperrt Android 13+ den Schalter als "eingeschraenkte Einstellung".
        root.addView(
            TextView(this).apply {
                textSize = 13f
                text = "Bleibt der Schalter in den Bedienungshilfen grau (per APK installiert): " +
                    "Einstellungen > Apps > YFRemote > Menue oben rechts > " +
                    "\"Eingeschraenkte Einstellungen zulassen\"."
                setPadding(0, dp(8), 0, 0)
            },
        )

        root.addView(sectionLabel("Gekoppelte Geraete", dp(24)))
        devicesContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(devicesContainer)

        return ScrollView(this).apply { addView(root) }
    }

    private fun sectionLabel(label: String, topPadding: Int) = TextView(this).apply {
        text = label
        textSize = 18f
        setPadding(0, topPadding, 0, 0)
        gravity = Gravity.START
    }

    // Settings.Secure statt nur der IME-Singleton-Instanz: Android erzeugt die IME erst, wenn sie
    // als Tastatur ausgewaehlt ist und ein Textfeld den Fokus bekommt - vorher waere "inaktiv"
    // irrefuehrend, obwohl der Nutzer alles richtig gemacht hat.
    private fun isYFRemoteDefaultIme(): Boolean =
        Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
            ?.startsWith("$packageName/") == true

    private fun ensureServiceRunning() {
        ContextCompat.startForegroundService(this, Intent(this, YFRemoteForegroundService::class.java))
    }

    private fun toggleService() {
        if (YFRemoteForegroundService.isRunning) {
            startService(Intent(this, YFRemoteForegroundService::class.java).setAction(YFRemoteForegroundService.ACTION_STOP))
        } else {
            ensureServiceRunning()
        }
        refreshHandler.postDelayed({ refreshUi() }, 300)
    }

    private fun refreshUi() {
        addressText.text = "Geraeteadresse: ${networkAddress() ?: "unbekannt"}:${KtorServer.DEFAULT_PORT}"

        val service = YFRemoteForegroundService.instance
        pinText.text = service?.pairing?.getCurrentPin()?.first ?: "Dienst nicht aktiv"
        toggleButton.text = if (YFRemoteForegroundService.isRunning) "Dienst stoppen" else "Dienst starten"

        accessibilityStatusText.text =
            "Bedienungshilfe: " + (if (YFRemoteAccessibilityService.instance != null) "aktiv" else "inaktiv")
        keyboardStatusText.text = "Tastatur: " + when {
            YFRemoteInputMethodService.instance != null -> "aktiv"
            isYFRemoteDefaultIme() -> "ausgewaehlt, startet beim ersten Tippen"
            else -> "inaktiv"
        }

        devicesContainer.removeAllViews()
        service?.pairing?.getPairedDevices()?.forEach { device ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(
                TextView(this).apply {
                    text = device.name
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                },
            )
            row.addView(
                Button(this).apply {
                    text = "Entkoppeln"
                    setOnClickListener {
                        service.pairing.removeDevice(device.id)
                        refreshUi()
                    }
                },
            )
            devicesContainer.addView(row)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    // ponytail: simple erste-nicht-loopback-IPv4-Heuristik statt der Gateway-Praeferenz von
    // NetworkAddressService.cs - fuer ein Telefon mit typischerweise einem aktiven WLAN-Interface
    // reicht das; Praeferenzlogik nachziehen, falls mehrere aktive Interfaces das je verwechseln.
    private fun networkAddress(): String? = try {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .filterIsInstance<Inet4Address>()
            .firstOrNull()
            ?.hostAddress
    } catch (e: Exception) {
        null
    }
}
