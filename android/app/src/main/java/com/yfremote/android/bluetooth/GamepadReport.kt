package com.yfremote.android.bluetooth

import kotlin.math.roundToInt

/**
 * HID-Report des Bluetooth-Controllers. Knopfreihenfolge nach der Linux-Gamepad-Zuordnung
 * (Button n -> BTN_GAMEPAD + n - 1), die Android fuer unbekannte Gamepads nutzt: 1 = A, 2 = B,
 * 4 = X, 5 = Y, 7/8 = LB/RB, 11 = Back, 12 = Start, 13 = Guide, 14/15 = Stick-Klicks. Linker Stick
 * X/Y, rechter Z/Rz, Trigger Brake/Gas (Android: AXIS_BRAKE/AXIS_GAS), Steuerkreuz als Hat.
 */
object GamepadReport {

    const val REPORT_ID = 1

    val DESCRIPTOR = byteArrayOf(
        0x05, 0x01, // Usage Page (Generic Desktop)
        0x09, 0x05, // Usage (Game Pad)
        0xA1.toByte(), 0x01, // Collection (Application)
        0x85.toByte(), REPORT_ID.toByte(), // Report ID
        0x05, 0x09, // Usage Page (Button)
        0x19, 0x01, 0x29, 0x0F, // Usage 1..15
        0x15, 0x00, 0x25, 0x01, // Logical 0..1
        0x75, 0x01, 0x95.toByte(), 0x0F, 0x81.toByte(), 0x02, // 15 x 1 Bit, Input
        0x75, 0x01, 0x95.toByte(), 0x01, 0x81.toByte(), 0x03, // 1 Bit Fuellung
        0x05, 0x01, // Usage Page (Generic Desktop)
        0x09, 0x39, // Usage (Hat Switch)
        0x15, 0x00, 0x25, 0x07, // Logical 0..7, 8 = Mitte (Null State)
        0x35, 0x00, 0x46, 0x3B, 0x01, // Physical 0..315
        0x65, 0x14, // Unit (Grad)
        0x75, 0x04, 0x95.toByte(), 0x01, 0x81.toByte(), 0x42, // 4 Bit, Input (Null State)
        0x65, 0x00, 0x45, 0x00, // Unit und Physical zuruecksetzen
        0x75, 0x04, 0x95.toByte(), 0x01, 0x81.toByte(), 0x03, // 4 Bit Fuellung
        0x09, 0x30, 0x09, 0x31, 0x09, 0x32, 0x09, 0x35, // X, Y, Z, Rz
        0x15, 0x81.toByte(), 0x25, 0x7F, // Logical -127..127
        0x75, 0x08, 0x95.toByte(), 0x04, 0x81.toByte(), 0x02, // 4 x 8 Bit, Input
        0x05, 0x02, // Usage Page (Simulation Controls)
        0x09, 0xC5.toByte(), 0x09, 0xC4.toByte(), // Brake (LT), Accelerator (RT)
        0x15, 0x00, 0x26, 0xFF.toByte(), 0x00, // Logical 0..255
        0x75, 0x08, 0x95.toByte(), 0x02, 0x81.toByte(), 0x02, // 2 x 8 Bit, Input
        0xC0.toByte(), // End Collection
    )

    // XInput-Bits, wie sie der Web-Client im GamepadState schickt (gamepad.component.ts).
    private const val UP = 0x0001
    private const val DOWN = 0x0002
    private const val LEFT = 0x0004
    private const val RIGHT = 0x0008
    private val BUTTONS = listOf(
        0x1000 to 1, // A
        0x2000 to 2, // B
        0x4000 to 4, // X
        0x8000 to 5, // Y
        0x0100 to 7, // LB
        0x0200 to 8, // RB
        0x0020 to 11, // Back
        0x0010 to 12, // Start
        0x0400 to 13, // Guide
        0x0040 to 14, // linker Stick-Klick
        0x0080 to 15, // rechter Stick-Klick
    )

    private const val AXIS_MAX = 32767

    /** Sticks -32767..32767 (oben positiv, wie XInput), Trigger 0..255. */
    fun build(buttons: Int, leftX: Int, leftY: Int, rightX: Int, rightY: Int, leftTrigger: Int, rightTrigger: Int): ByteArray {
        var bits = 0
        for ((xinput, hid) in BUTTONS) {
            if (buttons and xinput != 0) bits = bits or (1 shl (hid - 1))
        }

        return byteArrayOf(
            bits.toByte(),
            (bits shr 8).toByte(),
            hat(buttons).toByte(),
            axis(leftX),
            axis(-leftY), // HID: unten positiv
            axis(rightX),
            axis(-rightY),
            leftTrigger.coerceIn(0, 255).toByte(),
            rightTrigger.coerceIn(0, 255).toByte(),
        )
    }

    private fun axis(value: Int): Byte =
        (value.coerceIn(-AXIS_MAX, AXIS_MAX) * 127.0 / AXIS_MAX).roundToInt().toByte()

    private fun hat(buttons: Int): Int {
        val up = buttons and UP != 0 && buttons and DOWN == 0
        val down = buttons and DOWN != 0 && buttons and UP == 0
        val left = buttons and LEFT != 0 && buttons and RIGHT == 0
        val right = buttons and RIGHT != 0 && buttons and LEFT == 0

        return when {
            up && right -> 1
            down && right -> 3
            down && left -> 5
            up && left -> 7
            up -> 0
            right -> 2
            down -> 4
            left -> 6
            else -> 8
        }
    }
}
