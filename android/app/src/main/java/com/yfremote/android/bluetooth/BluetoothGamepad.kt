package com.yfremote.android.bluetooth

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors

/**
 * Meldet das Handy per Bluetooth-HID als Gamepad an einem anderen Geraet an (BluetoothHidDevice,
 * ab Android 9). Anders als der WebSocket-Weg braucht das Zielgeraet dafuer keine App - es sieht
 * einen normalen Bluetooth-Controller.
 *
 * Alle Aufrufer pruefen vorher BLUETOOTH_CONNECT (ab Android 12), daher MissingPermission; und
 * [start] bricht unter Android 9 ab, bevor irgendetwas anderes hier laeuft, daher TargetApi.
 */
@SuppressLint("MissingPermission")
@TargetApi(Build.VERSION_CODES.P)
object BluetoothGamepad {

    enum class State { UNSUPPORTED, OFF, REGISTERING, READY, CONNECTING, CONNECTED, FAILED }

    @Volatile
    var state = State.OFF
        private set

    @Volatile
    var host: BluetoothDevice? = null
        private set

    /** Wird auf dem Main-Thread aufgerufen, sobald sich [state] oder [host] aendert. */
    val listeners = mutableSetOf<() -> Unit>()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private var hid: BluetoothHidDevice? = null
    @Volatile
    private var registered = false
    @Volatile
    private var pending: BluetoothDevice? = null
    private var registeringSince = 0L
    private var lastReport = GamepadReport.build(0, 0, 0, 0, 0, 0, 0)

    fun isSupported(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && adapter(context) != null

    fun isEnabled(context: Context): Boolean = adapter(context)?.isEnabled == true

    fun bondedDevices(context: Context): List<BluetoothDevice> =
        adapter(context)?.bondedDevices.orEmpty().sortedBy { it.name.orEmpty() }

    // ponytail: bleibt registriert, solange der Prozess lebt (der Vordergrund-Dienst haelt ihn am
    // Leben) - ein unregisterApp beim Verlassen nachziehen, falls das je andere HID-Apps stoert.
    fun start(context: Context) {
        if (!isSupported(context)) {
            update(State.UNSUPPORTED)
            return
        }
        if (!isEnabled(context)) return
        // Haengt die Anmeldung (kein Callback), nach ein paar Sekunden neu versuchen.
        if (state == State.REGISTERING && System.currentTimeMillis() - registeringSince < REGISTER_TIMEOUT_MS) return

        // Android kann die Anmeldung jederzeit zuruecknehmen (auf dem S25 etwa beim Koppeln eines
        // neuen Geraets) - dann mit dem vorhandenen Proxy neu anmelden.
        val proxy = hid
        if (proxy != null) {
            if (!registered) register(proxy)
            return
        }

        registering()
        adapter(context)!!.getProfileProxy(
            context.applicationContext,
            object : BluetoothProfile.ServiceListener {
                override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                    register(proxy as BluetoothHidDevice)
                }

                override fun onServiceDisconnected(profile: Int) {
                    hid = null
                    registered = false
                    host = null
                    update(State.OFF)
                }
            },
            BluetoothProfile.HID_DEVICE,
        )
    }

    fun connect(device: BluetoothDevice) {
        val current = host
        // HID kennt nur ein Zielgeraet: erst das alte trennen, das neue folgt in onConnectionStateChanged.
        if (current != null && current != device) {
            pending = device
            hid?.disconnect(current)
            update(State.CONNECTING)
            return
        }
        if (hid?.connect(device) == true) update(State.CONNECTING)
    }

    fun disconnect() {
        host?.let { hid?.disconnect(it) }
    }

    /** Werte wie im GamepadState des Web-Clients. Ohne verbundenes Geraet false. */
    fun send(buttons: Int, leftX: Int, leftY: Int, rightX: Int, rightY: Int, leftTrigger: Int, rightTrigger: Int): Boolean {
        val device = host ?: return false
        val report = GamepadReport.build(buttons, leftX, leftY, rightX, rightY, leftTrigger, rightTrigger)
        lastReport = report
        return hid?.sendReport(device, GamepadReport.REPORT_ID, report) == true
    }

    private fun register(proxy: BluetoothHidDevice) {
        hid = proxy
        registering()
        val sdp = BluetoothHidDeviceAppSdpSettings(
            "YFRemote Controller",
            "Handy als Gamepad",
            "YFRemote",
            BluetoothHidDevice.SUBCLASS2_GAMEPAD,
            GamepadReport.DESCRIPTOR,
        )

        val ok = proxy.registerApp(sdp, null, null, executor, object : BluetoothHidDevice.Callback() {
            override fun onAppStatusChanged(pluggedDevice: BluetoothDevice?, registered: Boolean) {
                this@BluetoothGamepad.registered = registered
                if (!registered) {
                    host = null
                    update(State.OFF)
                    return
                }
                update(State.READY)
                // Ein schon einmal verbundenes Zielgeraet meldet Android hier - gleich wieder verbinden.
                pluggedDevice?.let { connect(it) }
            }

            override fun onConnectionStateChanged(device: BluetoothDevice, newState: Int) {
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        host = device
                        update(State.CONNECTED)
                    }
                    BluetoothProfile.STATE_CONNECTING -> update(State.CONNECTING)
                    BluetoothProfile.STATE_DISCONNECTED -> if (host == null || host == device) {
                        host = null
                        update(State.READY)
                        pending?.let {
                            pending = null
                            connect(it)
                        }
                    }
                }
            }

            // Manche Hosts (Windows) fragen beim Verbinden den aktuellen Zustand ab.
            override fun onGetReport(device: BluetoothDevice, type: Byte, id: Byte, bufferSize: Int) {
                proxy.replyReport(device, type, GamepadReport.REPORT_ID.toByte(), lastReport)
            }
        })
        if (!ok) update(State.FAILED)
    }

    private fun registering() {
        registeringSince = System.currentTimeMillis()
        update(State.REGISTERING)
    }

    private const val REGISTER_TIMEOUT_MS = 5000L

    private fun update(newState: State) {
        state = newState
        mainHandler.post { listeners.toList().forEach { it() } }
    }

    private fun adapter(context: Context): BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter
}
