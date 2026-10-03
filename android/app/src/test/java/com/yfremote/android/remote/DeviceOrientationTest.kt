package com.yfremote.android.remote

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class DeviceOrientationTest {

    private fun rotX(deg: Double): FloatArray {
        val a = Math.toRadians(deg)
        return floatArrayOf(1f, 0f, 0f, 0f, cos(a).toFloat(), -sin(a).toFloat(), 0f, sin(a).toFloat(), cos(a).toFloat())
    }

    private fun rotY(deg: Double): FloatArray {
        val a = Math.toRadians(deg)
        return floatArrayOf(cos(a).toFloat(), 0f, sin(a).toFloat(), 0f, 1f, 0f, -sin(a).toFloat(), 0f, cos(a).toFloat())
    }

    @Test
    fun `flat phone has no tilt`() {
        val (alpha, beta, gamma) = deviceOrientation(floatArrayOf(1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f))
        assertEquals(0.0, alpha, 0.01)
        assertEquals(0.0, beta, 0.01)
        assertEquals(0.0, gamma, 0.01)
    }

    @Test
    fun `tilting the top edge up gives positive beta`() {
        val (_, beta, gamma) = deviceOrientation(rotX(30.0))
        assertEquals(30.0, beta, 0.01)
        assertEquals(0.0, gamma, 0.01)
    }

    @Test
    fun `tilting the right edge down gives positive gamma`() {
        val (_, beta, gamma) = deviceOrientation(rotY(25.0))
        assertEquals(0.0, beta, 0.01)
        assertEquals(25.0, gamma, 0.01)
    }

    @Test
    fun `upside down phone wraps beta to the far side`() {
        val (_, beta, _) = deviceOrientation(rotX(150.0))
        assertEquals(150.0, beta, 0.01)
    }
}
