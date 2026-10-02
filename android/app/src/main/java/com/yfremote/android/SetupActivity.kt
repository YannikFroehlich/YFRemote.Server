package com.yfremote.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.WebStorage
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.integration.android.IntentIntegrator
import com.journeyapps.barcodescanner.BarcodeEncoder
import com.yfremote.android.accessibility.YFRemoteAccessibilityService
import com.yfremote.android.bluetooth.BluetoothGamepad
import com.yfremote.android.bluetooth.GamepadActivity
import com.yfremote.android.ime.YFRemoteInputMethodService
import com.yfremote.android.remote.RemoteDevice
import com.yfremote.android.remote.RemoteDevices
import com.yfremote.android.remote.RemoteWebActivity
import com.yfremote.android.remote.WakeOnLan
import com.yfremote.android.server.KtorServer
import com.yfremote.android.service.YFRemoteForegroundService
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

// Android-Aequivalent zu TrayApplicationContext (Windows) - PIN-Anzeige, gekoppelte Geraete,
// Links zu den zwei manuell zu erteilenden Berechtigungen, Start/Stopp fuer den Dienst (siehe
// PLAN.md, Stufe 5). Bewusst ohne AndroidX-UI-Toolkit (RecyclerView, Compose, Material) -
// programmatisch gebaute Views mit den Farben aus res/values/colors.xml.
class SetupActivity : Activity() {

    private lateinit var addressText: TextView
    private lateinit var pinText: TextView
    private lateinit var qrImage: ImageView
    private var qrPayload: String? = null
    private lateinit var toggleButton: Button
    private lateinit var serviceStatus: StatusRow
    private lateinit var accessibilityStatus: StatusRow
    private lateinit var keyboardStatus: StatusRow
    private lateinit var devicesContainer: LinearLayout
    private lateinit var remoteContainer: LinearLayout
    private lateinit var subtitleText: TextView
    private lateinit var sections: List<Section>
    private lateinit var navItems: List<NavItem>
    private lateinit var gamepadStatus: StatusRow
    private lateinit var gamepadDevices: LinearLayout
    private lateinit var gamepadPageView: View
    private val gamepadListener = { refreshGamepad() }

    private lateinit var remoteDevices: RemoteDevices
    private val remoteStatus = ConcurrentHashMap<String, String>()
    private val remoteCheckRunning = AtomicBoolean(false)
    private val remoteCheckExecutor = Executors.newSingleThreadExecutor()

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
        remoteDevices = RemoteDevices(this)
        requestNotificationPermissionIfNeeded()
        setContentView(buildLayout())
        ensureServiceRunning()
    }

    override fun onResume() {
        super.onResume()
        BluetoothGamepad.listeners += gamepadListener
        refreshHandler.post(refreshRunnable)
    }

    override fun onPause() {
        BluetoothGamepad.listeners -= gamepadListener
        refreshHandler.removeCallbacks(refreshRunnable)
        super.onPause()
    }

    override fun onDestroy() {
        remoteCheckExecutor.shutdownNow()
        super.onDestroy()
    }

    /** Ein Bereich der App mit eigenem Eintrag in der Leiste unten. */
    private class Section(val label: String, val subtitle: String, val icon: Int, val page: View)

    private fun buildLayout(): View {
        // Weitere Bereiche (z. B. ein Bluetooth-Controller) sind nur ein Eintrag mehr hier.
        sections = listOf(
            Section("Steuern", "Andere Geräte von hier steuern", R.drawable.ic_nav_control, controlPage()),
            Section("Freigeben", "Dieses Telefon fernsteuern lassen", R.drawable.ic_nav_share, sharePage()),
            Section("Controller", "Handy als Bluetooth-Controller", R.drawable.ic_nav_gamepad, gamepadPage()),
        )

        val root = column().apply { setPadding(dp(20), dp(24), dp(20), dp(32)) }
        root.addView(header())
        sections.forEach { root.addView(it.page) }

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }

        return column().apply {
            setBackgroundColor(color(R.color.brand_background))
            addView(scroll)
            addView(navigationBar())
            showSection(prefs().getInt(KEY_SECTION, 0).coerceIn(sections.indices))
        }
    }

    private class NavItem(val view: View, val label: TextView, val icon: ImageView)

    // Die Leiste folgt dem System des Geraets: Samsung-Apps (One UI) haben unten eine Leiste ueber
    // die ganze Breite mit Trennlinie, aktiver Eintrag hell und fett; sonst Material 3 - schwebende
    // Leiste mit Pille um den aktiven Eintrag.
    private val oneUi = Build.MANUFACTURER.equals("samsung", ignoreCase = true)

    private fun navigationBar(): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        navItems = sections.mapIndexed { index, section ->
            val icon = ImageView(this).apply {
                setImageResource(section.icon)
                layoutParams = LinearLayout.LayoutParams(dp(24), dp(24))
            }
            val label = TextView(this).apply {
                text = section.label
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_SP, if (oneUi) 13f else 12f)
                setPadding(0, dp(4), 0, 0)
            }
            val item = column().apply {
                gravity = Gravity.CENTER
                addView(icon)
                addView(label)
                layoutParams = LinearLayout.LayoutParams(0, dp(64), 1f).apply {
                    leftMargin = dp(4)
                    rightMargin = dp(4)
                }
                setOnClickListener { showSection(index) }
            }
            bar.addView(item)
            NavItem(item, label, icon)
        }

        return if (oneUi) {
            column().apply {
                setBackgroundColor(color(R.color.brand_surface))
                addView(
                    View(this@SetupActivity).apply {
                        setBackgroundColor(color(R.color.brand_surface_stroke))
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1))
                    },
                )
                addView(bar.apply { setPadding(dp(12), dp(4), dp(12), dp(8)) })
            }
        } else {
            bar.apply {
                background = GradientDrawable().apply {
                    cornerRadius = dp(36).toFloat()
                    setColor(color(R.color.brand_surface))
                    setStroke(dp(1), color(R.color.brand_surface_stroke))
                }
                setPadding(dp(8), dp(8), dp(8), dp(8))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { setMargins(dp(16), dp(4), dp(16), dp(12)) }
            }
        }
    }

    private fun showSection(index: Int) {
        sections.forEachIndexed { i, section ->
            section.page.visibility = if (i == index) View.VISIBLE else View.GONE
        }
        navItems.forEachIndexed { i, item ->
            val selected = i == index
            val tint = color(
                when {
                    !selected -> R.color.brand_text_muted
                    oneUi -> R.color.brand_text
                    else -> R.color.brand_accent
                },
            )
            item.label.setTextColor(tint)
            item.label.setTypeface(null, if (selected) Typeface.BOLD else Typeface.NORMAL)
            item.icon.setColorFilter(tint)
            item.view.background = if (selected && !oneUi) {
                GradientDrawable().apply {
                    cornerRadius = dp(24).toFloat()
                    // Akzent mit 20 % Deckkraft - wie der "secondary container" in Material 3.
                    setColor((color(R.color.brand_accent) and 0x00FFFFFF) or 0x33000000)
                }
            } else {
                null
            }
        }
        subtitleText.text = sections[index].subtitle
        if (sections[index].page === gamepadPageView) refreshGamepad()
        prefs().edit().putInt(KEY_SECTION, index).apply()
    }

    private fun prefs() = getSharedPreferences("setup", MODE_PRIVATE)

    private fun controlPage(): View = column().apply {
        addView(
            card("Geräte").apply {
                remoteContainer = column()
                addView(remoteContainer)
                addView(primaryButton("QR-Code scannen") { scanQrCode() })
                addView(secondaryButton("Adresse eingeben") { showAddDeviceDialog() })
            },
        )
    }

    private fun sharePage(): View = column().apply {
        val root = this
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
                        text = "QR-Code mit dem steuernden Gerät scannen oder die PIN in dessen Browser eingeben"
                        setPadding(0, 0, 0, dp(14))
                    },
                )

                qrImage = ImageView(this@SetupActivity).apply {
                    contentDescription = "QR-Code zum Verbinden"
                    visibility = View.GONE
                    layoutParams = LinearLayout.LayoutParams(dp(QR_SIZE_DP), dp(QR_SIZE_DP)).apply {
                        gravity = Gravity.CENTER_HORIZONTAL
                        bottomMargin = dp(14)
                    }
                }
                addView(qrImage)

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
                subtitleText = mutedText()
                addView(subtitleText)
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
        YFRemoteForegroundService.instance?.pairing?.regeneratePin()
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

    private fun showAddDeviceDialog() {
        val addressInput = EditText(this).apply {
            hint = "IP-Adresse, z. B. 192.168.0.10"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
        }
        val nameInput = EditText(this).apply {
            hint = "Name (optional)"
            setSingleLine()
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Gerät hinzufügen")
            .setMessage("Port ${RemoteDevices.DEFAULT_PORT}, falls keiner angegeben ist. Die PIN fragt das Gerät danach ab.")
            .setView(
                column().apply {
                    setPadding(dp(20), 0, dp(20), 0)
                    addView(addressInput)
                    addView(nameInput)
                },
            )
            .setPositiveButton("Verbinden", null)
            .setNegativeButton("Abbrechen", null)
            .create()

        // Eigener Listener statt setPositiveButton-Callback: der wuerde den Dialog auch bei einer
        // ungueltigen Adresse schliessen.
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val url = RemoteDevices.normalizeAddress(addressInput.text.toString())
                if (url == null) {
                    addressInput.error = "Ungültige Adresse"
                    return@setOnClickListener
                }
                val device = RemoteDevice(
                    url,
                    nameInput.text.toString().trim().ifEmpty { url.removePrefix("http://") },
                )
                remoteDevices.add(device)
                dialog.dismiss()
                openRemote(device)
            }
        }
        dialog.show()
    }

    // IntentIntegrator ist zugunsten von ScanContract (AndroidX Activity Result API) veraltet -
    // diese Activity kommt bewusst ohne AndroidX aus.
    @Suppress("DEPRECATION")
    private fun scanQrCode() {
        IntentIntegrator(this)
            .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            .setPrompt("QR-Code aus dem Tray-Menü des PCs oder aus \"Freigeben\" eines Handys scannen")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
            .initiateScan()
    }

    @Deprecated("Activity ohne AndroidX - onActivityResult ist hier der einzige Weg.")
    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
            ?: return super.onActivityResult(requestCode, resultCode, data)
        // contents == null: Scan abgebrochen.
        val contents = result.contents ?: return
        val (url, pin) = RemoteDevices.parseQrCode(contents) ?: run {
            Toast.makeText(this, "Kein YFRemote-QR-Code", Toast.LENGTH_LONG).show()
            return
        }

        // Bekanntes Geraet behaelt seinen Namen, nur die PIN kommt neu dazu.
        val device = remoteDevices.load().firstOrNull { it.url == url }
            ?: RemoteDevice(url, url.removePrefix("http://")).also { remoteDevices.add(it) }
        openRemote(device, pin)
    }

    // Die PIN im Fragment traegt der Web-Client selbst ins Kopplungsformular ein, wie beim QR-Code
    // im Browser (getPairingPinFromHash) - das Fragment erreicht den Server nie.
    private fun openRemote(device: RemoteDevice, pin: String? = null) {
        startActivity(
            Intent(this, RemoteWebActivity::class.java)
                .putExtra(RemoteWebActivity.EXTRA_URL, if (pin == null) device.url else "${device.url}/#pin=$pin")
                .putExtra(RemoteWebActivity.EXTRA_NAME, device.name),
        )
    }

    private fun removeRemote(device: RemoteDevice) {
        remoteDevices.remove(device.url)
        remoteStatus.remove(device.url)
        // Loescht das Pairing-Token im WebView, damit ein erneutes Hinzufuegen wieder die PIN
        // verlangt. Am Zielgeraet bleibt die Kopplung stehen, bis sie dort entfernt wird.
        WebStorage.getInstance().deleteOrigin(device.url)
        refreshUi()
    }

    private fun checkRemoteDevices(devices: List<RemoteDevice>) {
        if (devices.isEmpty() || !remoteCheckRunning.compareAndSet(false, true)) return

        remoteCheckExecutor.execute {
            try {
                for (device in devices) {
                    val health = fetchHealth(device.url)
                    remoteStatus[device.url] = health?.optString("platform") ?: OFFLINE
                    val mac = health?.optString("macAddress").orEmpty()
                    if (mac.isNotEmpty() && mac != device.mac) remoteDevices.setMac(device.url, mac)
                }
            } finally {
                remoteCheckRunning.set(false)
            }
        }
    }

    // /health ist ohne Kopplung erreichbar und nennt Plattform und MAC - reicht fuer "online".
    // null heisst offline.
    private fun fetchHealth(url: String): JSONObject? = try {
        (URL("$url/health").openConnection() as HttpURLConnection).run {
            connectTimeout = 1500
            readTimeout = 1500
            try {
                if (responseCode == 200) JSONObject(inputStream.bufferedReader().readText()) else null
            } finally {
                disconnect()
            }
        }
    } catch (e: Exception) {
        null
    }

    private fun wakeRemote(device: RemoteDevice) {
        val mac = device.mac ?: return
        remoteCheckExecutor.execute {
            val sent = runCatching { WakeOnLan.send(mac) }.getOrDefault(false)
            runOnUiThread {
                Toast.makeText(
                    this,
                    if (sent) "Weckruf an ${device.name} gesendet" else "Weckruf konnte nicht gesendet werden",
                    Toast.LENGTH_SHORT,
                ).show()
            }
        }
    }

    private fun refreshRemoteDevices() {
        val devices = remoteDevices.load()
        // Nur pruefen, solange die Liste sichtbar ist - sonst laeuft im Hintergrund unnoetig Netzverkehr.
        if (remoteContainer.isShown) checkRemoteDevices(devices)
        remoteContainer.removeAllViews()

        if (devices.isEmpty()) {
            remoteContainer.addView(
                mutedText().apply {
                    text = "Noch kein Gerät hinzugefügt. Auf dem PC zeigt das Tray-Menü unter " +
                        "\"QR-Code zum Verbinden...\" den Code zum Scannen."
                    setPadding(0, 0, 0, dp(6))
                },
            )
            return
        }

        val clickable = TypedValue().also {
            theme.resolveAttribute(android.R.attr.selectableItemBackground, it, true)
        }

        for (device in devices) {
            val status = remoteStatus[device.url]
            val dot = View(this).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(
                        when (status) {
                            null -> color(R.color.brand_text_muted)
                            OFFLINE -> color(R.color.brand_error)
                            else -> color(R.color.brand_ok)
                        },
                    )
                }
                layoutParams = LinearLayout.LayoutParams(dp(10), dp(10)).apply { rightMargin = dp(12) }
            }

            remoteContainer.addView(
                LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(6), 0, dp(6))
                    setBackgroundResource(clickable.resourceId)
                    setOnClickListener { openRemote(device) }

                    addView(dot)
                    addView(
                        column().apply {
                            layoutParams =
                                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                            addView(
                                TextView(this@SetupActivity).apply {
                                    text = device.name
                                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                                    setTextColor(color(R.color.brand_text))
                                },
                            )
                            addView(
                                mutedText().apply {
                                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                                    val address = device.url.removePrefix("http://")
                                    text = remoteStatusText(status) +
                                        if (device.name == address) "" else " · $address"
                                },
                            )
                        },
                    )
                    if (status == OFFLINE && device.mac != null) {
                        addView(
                            secondaryButton("Aufwecken") { wakeRemote(device) }.apply {
                                layoutParams = LinearLayout.LayoutParams(
                                    ViewGroup.LayoutParams.WRAP_CONTENT,
                                    dp(42),
                                ).apply { rightMargin = dp(8) }
                            },
                        )
                    }
                    addView(
                        secondaryButton("Entfernen") { removeRemote(device) }.apply {
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

    private fun remoteStatusText(status: String?): String = when (status) {
        null -> "Prüfe..."
        OFFLINE -> "Offline"
        "windows" -> "Online, Windows-PC"
        "linux" -> "Online, Linux-PC"
        "android" -> "Online, Android-Gerät"
        else -> "Online"
    }

    private fun gamepadPage(): View = column().also { gamepadPageView = it }.apply {
        addView(
            card("Bluetooth-Controller").apply {
                gamepadStatus = statusRow()
                addView(gamepadStatus.row)
                addView(
                    mutedText().apply {
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                        text = "Das Handy meldet sich per Bluetooth als Controller an, etwa an einem " +
                            "Android-Gerät oder PC. Dort ist keine App nötig. Designs und Editor wie im " +
                            "Controller-Modus der Fernbedienung, ohne Vibration."
                        setPadding(0, 0, 0, dp(6))
                    },
                )
                addView(
                    primaryButton("Controller öffnen") {
                        startActivity(Intent(this@SetupActivity, GamepadActivity::class.java))
                    },
                )
            },
        )
        addView(
            card("Zielgerät").apply {
                gamepadDevices = column()
                addView(gamepadDevices)
                addView(
                    mutedText().apply {
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                        text = "Neues Gerät: in den Bluetooth-Einstellungen mit diesem Handy koppeln " +
                            "und hier verbinden. Oder das Handy sichtbar machen und am Zielgerät nach " +
                            "Bluetooth-Geräten suchen."
                        setPadding(0, dp(10), 0, 0)
                    },
                )
                addView(
                    secondaryButton("Bluetooth-Einstellungen") {
                        startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                    },
                )
                addView(secondaryButton("Sichtbar machen") { makeDiscoverable() })
            },
        )
    }

    // Geraetenamen lesen braucht BLUETOOTH_CONNECT - geprueft ueber hasBluetoothPermissions().
    @SuppressLint("MissingPermission")
    private fun refreshGamepad() {
        gamepadDevices.removeAllViews()

        if (!BluetoothGamepad.isSupported(this)) {
            gamepadStatus.set("Braucht Android 9 und Bluetooth", color(R.color.brand_error))
            return
        }
        if (!hasBluetoothPermissions()) {
            gamepadStatus.set("Bluetooth-Berechtigung fehlt", color(R.color.brand_warn))
            gamepadDevices.addView(primaryButton("Berechtigung erteilen") { requestBluetoothPermissions() })
            return
        }
        if (!BluetoothGamepad.isEnabled(this)) {
            gamepadStatus.set("Bluetooth ist ausgeschaltet", color(R.color.brand_error))
            return
        }

        BluetoothGamepad.start(this)
        val host = BluetoothGamepad.host
        when (BluetoothGamepad.state) {
            BluetoothGamepad.State.CONNECTED ->
                gamepadStatus.set("Verbunden mit ${host?.name ?: "Gerät"}", color(R.color.brand_ok))
            BluetoothGamepad.State.CONNECTING -> gamepadStatus.set("Verbinde...", color(R.color.brand_warn))
            BluetoothGamepad.State.READY -> gamepadStatus.set("Bereit, nicht verbunden", color(R.color.brand_warn))
            BluetoothGamepad.State.FAILED ->
                gamepadStatus.set("Anmeldung als Controller fehlgeschlagen", color(R.color.brand_error))
            else -> gamepadStatus.set("Starte...", color(R.color.brand_text_muted))
        }

        // Das verbundene Geraet zuerst, damit "Trennen" ohne Scrollen erreichbar ist.
        val devices = BluetoothGamepad.bondedDevices(this).sortedByDescending { it == host }
        if (devices.isEmpty()) {
            gamepadDevices.addView(mutedText().apply { text = "Noch kein Bluetooth-Gerät gekoppelt." })
        }
        for (device in devices) {
            val connected = device == host
            gamepadDevices.addView(
                LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    if (connected) {
                        // Gruen hinterlegt wie der Status-Punkt, damit das aktive Zielgeraet auffaellt.
                        val ok = color(R.color.brand_ok)
                        background = GradientDrawable().apply {
                            cornerRadius = dp(12).toFloat()
                            setColor((ok and 0x00FFFFFF) or 0x26000000)
                            setStroke(dp(1), (ok and 0x00FFFFFF) or 0x80000000.toInt())
                        }
                        setPadding(dp(12), dp(6), dp(8), dp(6))
                        layoutParams = LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT,
                        ).apply { bottomMargin = dp(6) }
                    } else {
                        setPadding(0, dp(4), 0, dp(4))
                    }
                    addView(
                        column().apply {
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                            addView(
                                TextView(this@SetupActivity).apply {
                                    text = device.name ?: device.address
                                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                                    setTextColor(color(R.color.brand_text))
                                    if (connected) setTypeface(null, Typeface.BOLD)
                                },
                            )
                            if (connected) {
                                addView(
                                    TextView(this@SetupActivity).apply {
                                        text = "Verbunden"
                                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                                        setTextColor(color(R.color.brand_ok))
                                    },
                                )
                            }
                        },
                    )
                    addView(
                        secondaryButton(if (connected) "Trennen" else "Verbinden") {
                            if (connected) BluetoothGamepad.disconnect() else BluetoothGamepad.connect(device)
                        }.apply {
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(42))
                        },
                    )
                },
            )
        }
    }

    // Ab Android 12 Laufzeit-Berechtigungen; davor reichen die im Manifest.
    private fun bluetoothPermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE)
        } else {
            emptyArray()
        }

    private fun hasBluetoothPermissions(): Boolean =
        bluetoothPermissions().all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    private fun requestBluetoothPermissions() = requestPermissions(bluetoothPermissions(), BLUETOOTH_REQUEST)

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == BLUETOOTH_REQUEST) refreshGamepad()
    }

    private fun makeDiscoverable() {
        if (!hasBluetoothPermissions()) return requestBluetoothPermissions()
        startActivity(
            Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE)
                .putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 120),
        )
    }

    private fun refreshUi() {
        refreshRemoteDevices()
        // Nur solange der Bereich offen ist - sonst meldet sich das Handy ungefragt als Controller an.
        if (gamepadDevices.isShown) refreshGamepad()

        val running = YFRemoteForegroundService.isRunning
        val service = YFRemoteForegroundService.instance

        val address = networkAddress()
        val pin = service?.pairing?.getCurrentPin()?.first
        addressText.text = "${address ?: "Adresse unbekannt"}:${KtorServer.DEFAULT_PORT}"
        pinText.text = pin ?: "------"
        // Gleicher Aufbau wie PairingQrCodePayload.cs. Die PIN steht ohnehin gross daneben, daher
        // anders als im Tray ohne Schalter immer im Code.
        showQrCode(if (address != null && pin != null) "http://$address:${KtorServer.DEFAULT_PORT}/#pin=$pin" else null)
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
                            service?.removeDevice(device.id)
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

    // refreshUi laeuft alle 2 s - neu gezeichnet wird nur, wenn sich Adresse oder PIN geaendert haben.
    private fun showQrCode(payload: String?) {
        if (payload == qrPayload) return
        qrPayload = payload
        qrImage.visibility = if (payload == null) View.GONE else View.VISIBLE
        if (payload != null) {
            qrImage.setImageBitmap(
                BarcodeEncoder().encodeBitmap(payload, BarcodeFormat.QR_CODE, dp(QR_SIZE_DP), dp(QR_SIZE_DP)),
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

    // Die Gateway-Praeferenz von NetworkAddressService.cs passt hier nicht: Beim Hotspot hat gerade
    // der Mobilfunk das Gateway, die Geraete kommen aber ueber das Hotspot-Netz. Deshalb zaehlt, ob
    // ein Interface aktives WLAN/Ethernet oder Mobilfunk ist (Details bei pickLanAddress).
    @Suppress("DEPRECATION") // allNetworks: der Ersatz waere ein NetworkCallback fuer eine Momentaufnahme.
    private fun networkAddress(): String? = try {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        fun interfaceOf(network: Network?) = network?.let { connectivity.getLinkProperties(it)?.interfaceName }
        fun hasTransport(network: Network?, transport: Int) =
            connectivity.getNetworkCapabilities(network)?.hasTransport(transport) == true

        val active = connectivity.activeNetwork
        val activeLan = interfaceOf(active).takeIf {
            hasTransport(active, NetworkCapabilities.TRANSPORT_WIFI) ||
                hasTransport(active, NetworkCapabilities.TRANSPORT_ETHERNET)
        }
        val cellular = connectivity.allNetworks
            .filter { hasTransport(it, NetworkCapabilities.TRANSPORT_CELLULAR) }
            .mapNotNull { interfaceOf(it) }
            .toSet()

        pickLanAddress(
            NetworkInterface.getNetworkInterfaces().asSequence()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { nic -> nic.inetAddresses.asSequence().filterIsInstance<Inet4Address>().map { nic.name to it } }
                .toList(),
            activeLan,
            cellular,
        )
    } catch (e: Exception) {
        null
    }

    private companion object {
        const val OFFLINE = "offline"
        const val KEY_SECTION = "section"
        const val BLUETOOTH_REQUEST = 2
        const val QR_SIZE_DP = 220
    }
}

/** Waehlt die Adresse, unter der andere Geraete im lokalen Netz dieses Handy erreichen: zuerst das
 *  aktive WLAN/Ethernet, Mobilfunk zuletzt (Netzbetreiber vergeben oft ebenfalls 10.x.x.x), sonst
 *  private Adressen vor Tailscale & Co. in 100.64.0.0/10. Beim Hotspot ist Mobilfunk das aktive
 *  Netz, dann gewinnt die private Adresse des Hotspot-Interfaces. */
internal fun pickLanAddress(
    candidates: List<Pair<String, Inet4Address>>,
    activeLanInterface: String?,
    cellularInterfaces: Set<String>,
): String? = candidates
    .sortedWith(
        compareByDescending<Pair<String, Inet4Address>> { it.first == activeLanInterface }
            .thenBy { it.first in cellularInterfaces }
            .thenByDescending { it.second.isSiteLocalAddress },
    )
    .firstOrNull()
    ?.second
    ?.hostAddress
