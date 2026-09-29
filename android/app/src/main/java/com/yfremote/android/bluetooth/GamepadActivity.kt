package com.yfremote.android.bluetooth

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.yfremote.android.R
import java.io.IOException
import org.json.JSONObject

// Zeigt den Controller des Web-Clients aus den App-Assets (dieselben Designs und derselbe Editor
// wie im Browser) und schickt seinen Zustand per Bluetooth statt per WebSocket. Der Client
// erkennt diesen Modus an window.YFRemoteBluetooth (client/src/app/remote/gamepad/gamepad-transport.ts).
class GamepadActivity : Activity() {

    private lateinit var webView: WebView
    private val statusListener = { pushStatus() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.brand_background))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Nur die eigenen Assets: die Bridge unten darf keine fremde Seite erreichen.
            addJavascriptInterface(Bridge(), "YFRemoteBluetooth")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.host != ASSET_HOST

                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (request.url.host == ASSET_HOST) asset(request.url.path.orEmpty()) else null
            }
        }
        setContentView(webView)
        hideSystemBars()
        // https: ein sicherer Kontext - erst damit liefert der Browser die Lagesensoren fuer die
        // Neigungssteuerung.
        webView.loadUrl("https://$ASSET_HOST/")
    }

    override fun onStart() {
        super.onStart()
        BluetoothGamepad.listeners += statusListener
        pushStatus()
    }

    override fun onStop() {
        BluetoothGamepad.listeners -= statusListener
        // Alles loslassen, sonst bliebe z. B. Gas am Zielgeraet gedrueckt.
        BluetoothGamepad.send(0, 0, 0, 0, 0, 0, 0)
        super.onStop()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private fun pushStatus() {
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('yfremote-bluetooth-status', { detail: '${clientStatus()}' }))",
            null,
        )
    }

    private fun asset(path: String): WebResourceResponse? {
        val file = path.trimStart('/').ifEmpty { "index.html" }
        // Angular-Routen haben keine Dateiendung - die gehen an index.html (SPA-Fallback).
        val name = if ('.' in file.substringAfterLast('/')) file else "index.html"
        return try {
            val mime = MIME_TYPES[name.substringAfterLast('.')]
                ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.'))
                ?: "application/octet-stream"
            WebResourceResponse(mime, "UTF-8", assets.open("www/$name"))
        } catch (e: IOException) {
            WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null)
        }
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    private inner class Bridge {
        @JavascriptInterface
        fun sendGamepad(json: String): Boolean = try {
            val state = JSONObject(json)
            BluetoothGamepad.send(
                state.getInt("buttons"),
                state.getInt("leftX"),
                state.getInt("leftY"),
                state.getInt("rightX"),
                state.getInt("rightY"),
                state.getInt("leftTrigger"),
                state.getInt("rightTrigger"),
            )
        } catch (e: Exception) {
            false
        }

        @JavascriptInterface
        fun getStatus(): String = clientStatus()

        @JavascriptInterface
        fun close() = runOnUiThread { finish() }
    }

    companion object {
        private const val ASSET_HOST = "appassets.androidplatform.net"

        // MimeTypeMap kennt nicht auf jeder Android-Version alle Web-Typen; Module-Skripte
        // laden nur mit einem JavaScript-Typ.
        private val MIME_TYPES = mapOf(
            "html" to "text/html",
            "js" to "text/javascript",
            "mjs" to "text/javascript",
            "css" to "text/css",
            "json" to "application/json",
            "webmanifest" to "application/manifest+json",
            "svg" to "image/svg+xml",
            "png" to "image/png",
            "ico" to "image/x-icon",
            "woff2" to "font/woff2",
        )

        /** Die drei Zustaende, die der Client kennt (ConnectionStatus in remote.models.ts). */
        fun clientStatus(): String = when (BluetoothGamepad.state) {
            BluetoothGamepad.State.CONNECTED -> "connected"
            BluetoothGamepad.State.CONNECTING, BluetoothGamepad.State.REGISTERING -> "connecting"
            else -> "disconnected"
        }
    }
}
