package com.krisdiamondshop.admin

import android.Manifest
import android.content.ActivityNotFoundException
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activeActivity = this
        requestNotificationPermission()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView,
                    filePathCallback: ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams
                ): Boolean {
                    this@MainActivity.fileChooserCallback?.onReceiveValue(null)
                    this@MainActivity.fileChooserCallback = filePathCallback
                    val types = fileChooserParams.acceptTypes.filter { it.contains("/") }
                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = types.firstOrNull() ?: "*/*"
                        if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                        if (fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        }
                    }
                    return try {
                        startActivityForResult(
                            Intent.createChooser(intent, "Pilih file"),
                            FILE_CHOOSER_REQUEST
                        )
                        true
                    } catch (_: ActivityNotFoundException) {
                        this@MainActivity.fileChooserCallback?.onReceiveValue(null)
                        this@MainActivity.fileChooserCallback = null
                        false
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme == "https" && uri.host == "krisdiamondshop.vercel.app") return false
                    if (uri.scheme == "https" || uri.scheme == "mailto" || uri.scheme == "tel") {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    }
                    return true
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    view.evaluateJavascript(
                        "window.krisAdminAndroid = true; window.onKrisAdminAppReady && window.onKrisAdminAppReady()",
                        null
                    )
                    publishFcmToken()
                }
            }
        }
        setContentView(webView)
        webView.loadUrl(BuildConfig.ADMIN_URL)
        publishFcmToken()
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != FILE_CHOOSER_REQUEST) return
        val callback = fileChooserCallback ?: return
        fileChooserCallback = null
        callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
    }

    override fun onResume() {
        super.onResume()
        activeActivity = this
        publishFcmToken()
    }

    override fun onDestroy() {
        if (activeActivity === this) activeActivity = null
        webView.destroy()
        super.onDestroy()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST
            )
        }
    }

    private fun publishFcmToken() {
        if (!::webView.isInitialized) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
            webView.evaluateJavascript(
                "window.onKrisAdminNotificationPermissionRequired && window.onKrisAdminNotificationPermissionRequired()",
                null
            )
            return
        }
        try {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    runOnUiThread {
                        if (!isFinishing && ::webView.isInitialized) {
                            webView.evaluateJavascript(
                                "window.onKrisAdminFcmToken && window.onKrisAdminFcmToken(${JSONObject.quote(token)})",
                                null
                            )
                        }
                    }
                }
                .addOnFailureListener {
                    runOnUiThread {
                        if (!isFinishing && ::webView.isInitialized) {
                            webView.evaluateJavascript(
                                "window.onKrisAdminFcmUnavailable && window.onKrisAdminFcmUnavailable()",
                                null
                            )
                        }
                    }
                }
        } catch (_: IllegalStateException) {
            webView.evaluateJavascript(
                "window.onKrisAdminFcmUnavailable && window.onKrisAdminFcmUnavailable()",
                null
            )
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST
            && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            publishFcmToken()
        }
    }

    companion object {
        private const val FILE_CHOOSER_REQUEST = 1002
        private const val NOTIFICATION_PERMISSION_REQUEST = 1001
        @Volatile
        var activeActivity: MainActivity? = null

        fun showFcmToken(token: String) {
            activeActivity?.runOnUiThread {
                activeActivity?.webView?.evaluateJavascript(
                    "window.onKrisAdminFcmToken && window.onKrisAdminFcmToken(${JSONObject.quote(token)})",
                    null
                )
            }
        }
    }
}
