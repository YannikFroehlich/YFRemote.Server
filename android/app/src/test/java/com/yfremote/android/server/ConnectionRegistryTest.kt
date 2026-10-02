package com.yfremote.android.server

import io.ktor.server.websocket.DefaultWebSocketServerSession
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionRegistryTest {

    private var allClosedCount = 0
    private val registry = ConnectionRegistry { allClosedCount++ }

    @Test
    fun `onAllClosed laeuft erst, wenn die letzte Verbindung aller Geraete endet`() {
        val first = registry.register("phone", fakeSession())
        val second = registry.register("phone", fakeSession())
        val other = registry.register("tablet", fakeSession())

        first.close()
        other.close()
        assertEquals(0, allClosedCount)

        second.close()
        assertEquals(1, allClosedCount)
    }

    @Test
    fun `doppeltes close meldet nur einmal`() {
        val registration = registry.register("phone", fakeSession())

        registration.close()
        registration.close()

        assertEquals(1, allClosedCount)
    }

    // Die Registry nutzt die Session nur als Schluessel - equals/hashCode genuegen.
    private fun fakeSession(): DefaultWebSocketServerSession =
        Proxy.newProxyInstance(javaClass.classLoader, arrayOf(DefaultWebSocketServerSession::class.java)) { proxy, method, args ->
            when (method.name) {
                "equals" -> proxy === args?.get(0)
                "hashCode" -> System.identityHashCode(proxy)
                else -> throw UnsupportedOperationException(method.name)
            }
        } as DefaultWebSocketServerSession
}
