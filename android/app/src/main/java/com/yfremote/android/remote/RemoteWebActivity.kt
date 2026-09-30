package com.yfremote.android.remote

import android.app.Activity
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.yfremote.android.R
import com.yfremote.android.server.sanitizeFileName

// Laedt den Web-Client direkt vom gesteuerten Server - Kopplung (PIN), Tasten, Touchpad und
// Controller kommen so ohne eigenen Code in der App aus und bleiben immer auf dessen Stand.
class RemoteWebActivity : Activity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = intent.getStringExtra(EXTRA_NAME)
        val url = intent.getStringExtra(EXTRA_URL) ?: return finish()
        val origin = Uri.parse(url).let { "${it.scheme}://${it.encodedAuthority}" }

        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.brand_background))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // index.html und brand-mark.png haben keinen Hash im Namen - aus dem Cache kaeme nach
            // einem Update des Zielgeraets noch die alte Oberflaeche. Im LAN kostet frisch laden nichts.
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            webViewClient = WebViewClient()
            addJavascriptInterface(DownloadBridge(origin), "YFRemoteDownloads")
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
        webView.loadUrl(url)
    }

    // "Laden" bei einem Datei-Angebot: Der Web-Client holt die Datei per fetch und speichert sie als
    // blob:-Link - das kann das WebView nicht. Er ruft stattdessen hierher auf
    // (client/src/app/remote/file-transfer.service.ts, DOWNLOAD_BRIDGE).
    private inner class DownloadBridge(private val origin: String) {
        @JavascriptInterface
        fun download(url: String, token: String, fileName: String): Boolean {
            // Das Token geht nur an das Geraet, dessen Oberflaeche hier geladen ist.
            if (!url.startsWith("$origin/files/")) return false
            // Unter Android 10 braeuchte der Download-Ordner die Speicher-Berechtigung.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false

            val name = sanitizeFileName(fileName)
            return try {
                getSystemService(DownloadManager::class.java).enqueue(
                    DownloadManager.Request(Uri.parse(url))
                        .addRequestHeader("Authorization", "Bearer $token")
                        .setTitle(name)
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "YFRemote/$name"),
                )
                true
            } catch (e: Exception) {
                false
            }
        }
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
