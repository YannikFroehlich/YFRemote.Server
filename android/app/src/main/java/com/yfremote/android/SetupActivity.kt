package com.yfremote.android

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.ImageView
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
// PLAN.md, Stufe 5). Bewusst ohne AndroidX-UI-Toolkit (RecyclerView, Compose, Material) -
// programmatisch gebaute Views mit den Farben aus res/values/colors.xml.
class SetupActivity : Activity() {

    private lateinit var addressText: TextView
    private lateinit var pinText: TextView
    private lateinit var toggleButton: Button
    private lateinit var serviceStatus: StatusRow
    private lateinit var accessibilityStatus: StatusRow
    private lateinit var keyboardStatus: StatusRow
    private lateinit var devicesContainer: LinearLayout

    private val refreshHandler = Handler(Looper.getMainLooper())
    private val refreshRunnable = object : Runnable {
        override fun run() {
            refreshUi()
            refreshHandler.postDelayed(this, 2000)
        }
    }

    /** Punkt plus Text - die Farbe traegt den Zustand, damit er ohne Lesen erkennbar ist. */
    private class StatusRow(
        val row: LinearLayout,
        private val dot: View,
        private val label: TextView,
    ) {
        fun set(text: String, color: Int) {
            label.text = text
            (dot.background as GradientDrawable).setColor(color)
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
        val root = column().apply { setPadding(dp(20), dp(24), dp(20), dp(32)) }

        root.addView(header())

        root.addView(
            card("Verbindung").apply {
                addressText = mutedText()
                addView(addressText)

                pinText = TextView(this@SetupActivity).apply {
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 40f)
                    setTextColor(color(R.color.brand_text))
                    letterSpacing = 0.18f
                    setPadding(0, dp(10), 0, dp(2))
                }
                addView(pinText)
                addView(
                    mutedText().apply {
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                        text = "PIN im Browser des steuernden Geräts eingeben"
                        setPadding(0, 0, 0, dp(14))
                    },
                )

                serviceStatus = statusRow()
                addView(serviceStatus.row)

                toggleButton = primaryButton("Dienst starten") { toggleService() }
                addView(toggleButton)
                addView(secondaryButton("PIN neu erzeugen") { regeneratePin() })
            },
        )

        root.addView(
            card("Berechtigungen").apply {
                accessibilityStatus = statusRow()
                addView(accessibilityStatus.row)
                addView(
                    secondaryButton("Bedienungshilfe aktivieren") {
                        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    },
                )

                keyboardStatus = statusRow()
                keyboardStatus.row.setPadding(0, dp(14), 0, dp(10))
                addView(keyboardStatus.row)
                addView(
                    secondaryButton("Tastatur aktivieren") {
                        startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
                    },
                )
                // Aktivieren allein genuegt nicht: Android tippt nur ueber die *ausgewaehlte* IME,
                // und die Auswahl geht nur ueber diesen System-Dialog.
                addView(
                    secondaryButton("Tastatur auswählen") {
                        inputMethodManager().showInputMethodPicker()
                    },
                )

                // Haeufigster Grund fuer eine dauerhaft inaktive Bedienungshilfe: die App wurde per
                // APK installiert, dann sperrt Android 13+ den Schalter als "eingeschraenkte
                // Einstellung".
                addView(
                    mutedText().apply {
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                        text = "Bleibt der Schalter in den Bedienungshilfen grau (per APK " +
                            "installiert): Einstellungen > Apps > YFRemote > Menü oben rechts > " +
                            "\"Eingeschränkte Einstellungen zulassen\"."
                        setPadding(0, dp(14), 0, 0)
                    },
                )
            },
        )

        root.addView(
            card("Gekoppelte Geräte").apply {
                devicesContainer = column()
                addView(devicesContainer)
            },
        )

        return ScrollView(this).apply {
            setBackgroundColor(color(R.color.brand_background))
            isFillViewport = true
            addView(root)
        }
    }

    private fun header(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(4), 0, 0, dp(20))

        addView(
            ImageView(this@SetupActivity).apply {
                setImageResource(R.mipmap.ic_launcher)
                layoutParams = LinearLayout.LayoutParams(dp(52), dp(52))
            },
        )
        addView(
            column().apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { leftMargin = dp(14) }

                addView(
                    TextView(this@SetupActivity).apply {
                        text = "YFRemote"
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
                        setTextColor(color(R.color.brand_text))
                    },
                )
                addView(mutedText().apply { text = "Dieses Telefon fernsteuern" })
            },
        )
    }

    private fun card(title: String): LinearLayout = column().apply {
        background = GradientDrawable().apply {
            cornerRadius = dp(18).toFloat()
            setColor(color(R.color.brand_surface))
            setStroke(dp(1), color(R.color.brand_surface_stroke))
        }
        setPadding(dp(18), dp(16), dp(18), dp(18))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = dp(16) }

        addView(
            TextView(this@SetupActivity).apply {
                text = title.uppercase()
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                letterSpacing = 0.12f
                setTextColor(color(R.color.brand_accent))
                setPadding(0, 0, 0, dp(10))
            },
        )
    }

    private fun statusRow(): StatusRow {
        val dot = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color(R.color.brand_text_muted))
            }
            layoutParams = LinearLayout.LayoutParams(dp(10), dp(10)).apply { rightMargin = dp(10) }
        }
        val label = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(color(R.color.brand_text))
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(2), 0, dp(10))
            addView(dot)
            addView(label)
        }

        return StatusRow(row, dot, label)
    }

    private fun primaryButton(text: String, onClick: () -> Unit): Button = styledButton(
        text,
        color(R.color.brand_accent),
        color(R.color.brand_accent_pressed),
        Color.BLACK,
        onClick,
    )

    private fun secondaryButton(text: String, onClick: () -> Unit): Button = styledButton(
        text,
        color(R.color.brand_surface),
        color(R.color.brand_surface_stroke),
        color(R.color.brand_text),
        onClick,
    )

    private fun styledButton(
        text: String,
        fill: Int,
        pressedFill: Int,
        textColor: Int,
        onClick: () -> Unit,
    ): Button {
        fun pill(fillColor: Int) = GradientDrawable().apply {
            cornerRadius = dp(12).toFloat()
            setColor(fillColor)
            setStroke(dp(1), color(R.color.brand_surface_stroke))
        }

        return Button(this).apply {
            this.text = text
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(textColor)
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_pressed), pill(pressedFill))
                addState(intArrayOf(), pill(fill))
            }
            // Das Material-Theme hebt Buttons per Elevation-Animation an - zusammen mit einem
            // eigenen Hintergrund sieht das nach abgeschnittenem Schatten aus.
            stateListAnimator = null
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48),
            ).apply { topMargin = dp(8) }
            setOnClickListener { onClick() }
        }
    }

    private fun mutedText(): TextView = TextView(this).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTextColor(color(R.color.brand_text_muted))
    }

    private fun column(): LinearLayout =
        LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

    private fun ensureServiceRunning() {
        ContextCompat.startForegroundService(this, Intent(this, YFRemoteForegroundService::class.java))
    }

    private fun regeneratePin() {
        YFRemoteForegroundService.instance?.let {
            it.pairing.regeneratePin()
            it.refreshNotification()
        }
        refreshUi()
    }

    private fun toggleService() {
        if (YFRemoteForegroundService.isRunning) {
            startService(
                Intent(this, YFRemoteForegroundService::class.java)
                    .setAction(YFRemoteForegroundService.ACTION_STOP),
            )
        } else {
            ensureServiceRunning()
        }
        refreshHandler.postDelayed({ refreshUi() }, 300)
    }

    private fun refreshUi() {
        val running = YFRemoteForegroundService.isRunning
        val service = YFRemoteForegroundService.instance

        addressText.text = "${networkAddress() ?: "Adresse unbekannt"}:${KtorServer.DEFAULT_PORT}"
        pinText.text = service?.pairing?.getCurrentPin()?.first ?: "------"
        toggleButton.text = if (running) "Dienst stoppen" else "Dienst starten"
        serviceStatus.set(
            if (running) "Dienst läuft" else "Dienst gestoppt",
            if (running) color(R.color.brand_ok) else color(R.color.brand_error),
        )

        val accessibilityActive = YFRemoteAccessibilityService.instance != null
        accessibilityStatus.set(
            if (accessibilityActive) "Bedienungshilfe aktiv" else "Bedienungshilfe inaktiv",
            if (accessibilityActive) color(R.color.brand_ok) else color(R.color.brand_error),
        )

        when {
            YFRemoteInputMethodService.instance != null ->
                keyboardStatus.set("Tastatur aktiv", color(R.color.brand_ok))

            isYFRemoteImeSelected() ->
                keyboardStatus.set("Tastatur ausgewählt, startet beim Tippen", color(R.color.brand_ok))

            isYFRemoteImeEnabled() ->
                keyboardStatus.set("Tastatur aktiviert, nicht ausgewählt", color(R.color.brand_warn))

            else -> keyboardStatus.set("Tastatur inaktiv", color(R.color.brand_error))
        }

        devicesContainer.removeAllViews()
        val devices = service?.pairing?.getPairedDevices().orEmpty()

        if (devices.isEmpty()) {
            devicesContainer.addView(mutedText().apply { text = "Noch kein Gerät gekoppelt." })
            return
        }

        for (device in devices) {
            devicesContainer.addView(
                LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(4), 0, dp(4))

                    addView(
                        TextView(this@SetupActivity).apply {
                            text = device.name
                            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                            setTextColor(color(R.color.brand_text))
                            layoutParams =
                                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        },
                    )
                    addView(
                        secondaryButton("Entkoppeln") {
                            service?.pairing?.removeDevice(device.id)
                            refreshUi()
                        }.apply {
                            layoutParams = LinearLayout.LayoutParams(
                                ViewGroup.LayoutParams.WRAP_CONTENT,
                                dp(42),
                            )
                        },
                    )
                },
            )
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    // Settings.Secure statt nur der IME-Singleton-Instanz: Android erzeugt die IME erst, wenn sie
    // als Tastatur ausgewaehlt ist und ein Textfeld den Fokus bekommt - vorher waere "inaktiv"
    // irrefuehrend, obwohl der Nutzer alles richtig gemacht hat. "Aktiviert" und "ausgewaehlt" sind
    // zwei getrennte Schritte, deshalb zwei Abfragen.
    private fun isYFRemoteImeSelected(): Boolean =
        Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
            ?.startsWith("$packageName/") == true

    // Nicht ueber Settings.Secure.ENABLED_INPUT_METHODS: der Key ist ab targetSdk 34 gesperrt und
    // wirft eine SecurityException. InputMethodManager liefert dieselbe Liste offiziell.
    private fun isYFRemoteImeEnabled(): Boolean =
        inputMethodManager().enabledInputMethodList.any { it.packageName == packageName }

    private fun inputMethodManager() = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager

    private fun color(id: Int): Int = ContextCompat.getColor(this, id)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

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
