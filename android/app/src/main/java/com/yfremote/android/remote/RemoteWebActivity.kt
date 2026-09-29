package com.yfremote.android.remote

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import com.yfremote.android.R

// Laedt den Web-Client direkt vom gesteuerten Server - Kopplung (PIN), Tasten, Touchpad und
// Controller kommen so ohne eigenen Code in der App aus und bleiben immer auf dessen Stand.
class RemoteWebActivity : Activity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = intent.getStringExtra(EXTRA_NAME)

        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.brand_background))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = WebViewClient()
            // Ohne onShowFileChooser tut ein <input type="file"> im WebView nichts ("Datei senden").
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return try {
                        startActivityForResult(params.createIntent(), FILE_REQUEST)
                        true
                    } catch (e: Exception) {
                        fileCallback = null
                        false
                    }
                }
            }
        }
        setContentView(webView)
        webView.loadUrl(intent.getStringExtra(EXTRA_URL) ?: return finish())
    }

    @Deprecated("Activity ohne AndroidX - onActivityResult ist hier der einzige Weg.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_REQUEST) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_NAME = "name"
        private const val FILE_REQUEST = 1
    }
}
