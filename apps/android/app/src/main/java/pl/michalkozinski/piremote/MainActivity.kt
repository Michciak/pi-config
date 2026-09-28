package pl.michalkozinski.piremote

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var api: ApiClient
    private lateinit var status: TextView
    private lateinit var host: EditText
    private lateinit var code: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = ApiClient(this)
        setContentView(buildUi())
        requestNotificationPermission()
        if (!handleIntent(intent)) refreshStatus()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (::api.isInitialized && api.paired) refreshStatus()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun buildUi(): LinearLayout {
        val density = resources.displayMetrics.density
        fun pad(dp: Int) = (dp * density).toInt()
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(pad(24), pad(48), pad(24), pad(24))
            setBackgroundColor(Color.rgb(8, 11, 17))
            addView(TextView(context).apply {
                text = "π  Pi Remote"
                textSize = 30f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(TextView(context).apply {
                text = "Sterowanie lokalnym Pi Engine"
                textSize = 15f
                setTextColor(Color.rgb(160, 167, 184))
                gravity = Gravity.CENTER
                setPadding(0, pad(8), 0, pad(32))
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            host = field("Adres, np. 192.168.1.20:3784")
            code = field("Kod parowania")
            addView(host)
            addView(code)
            addView(Button(context).apply {
                text = "Sparuj urządzenie"
                setOnClickListener { pair(host.text.toString(), code.text.toString()) }
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(Button(context).apply {
                text = "Otwórz panel Pi"
                setOnClickListener { openWebPanel() }
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(Button(context).apply {
                text = "Odśwież stan"
                setOnClickListener { refreshStatus() }
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            status = TextView(context).apply {
                textSize = 15f
                setTextColor(Color.rgb(210, 214, 225))
                setPadding(0, pad(28), 0, 0)
            }
            addView(status, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
    }

    private fun field(hintText: String) = EditText(this).apply {
        hint = hintText
        setHintTextColor(Color.rgb(120, 128, 145))
        setTextColor(Color.WHITE)
        setSingleLine(true)
    }

    private fun handleIntent(intent: Intent): Boolean {
        val uri = intent.data
        if (uri?.scheme == "piremote" && uri.host == "pair") {
            val pairHost = uri.getQueryParameter("host") ?: return false
            val port = uri.getQueryParameter("port") ?: "3784"
            val pairCode = uri.getQueryParameter("code") ?: return false
            host.setText("$pairHost:$port")
            code.setText(pairCode)
            pair("$pairHost:$port", pairCode)
            return true
        }
        if (intent.getBooleanExtra(Notifications.EXTRA_OPEN_WEB, false)) {
            openWebPanel(intent.getStringExtra(Notifications.EXTRA_INTERACTION_ID))
            return true
        }
        return false
    }

    private fun pair(address: String, pairCode: String) {
        val normalized = address.removePrefix("http://").removePrefix("https://").trimEnd('/')
        val parts = normalized.split(":", limit = 2)
        val pairHost = parts.firstOrNull().orEmpty()
        val port = parts.getOrNull(1)?.toIntOrNull() ?: 3784
        if (pairHost.isBlank() || pairCode.length != 6) {
            status.text = "Podaj adres Maca i sześciocyfrowy kod."
            return
        }
        status.text = "Parowanie…"
        fun complete(fcmToken: String?) = executor.execute {
            runCatching { api.pair(pairHost, port, pairCode, fcmToken) }
                .onSuccess { runOnUiThread { status.text = "Urządzenie sparowane.\n${api.baseUrl}" } }
                .onFailure { error -> runOnUiThread { status.text = "Błąd parowania: ${error.message}" } }
        }
        runCatching { FirebaseMessaging.getInstance().token }
            .onSuccess { task -> task.addOnCompleteListener { complete(if (it.isSuccessful) it.result else null) } }
            .onFailure { complete(null) }
    }

    private fun refreshStatus() {
        if (!api.paired) {
            status.text = "Urządzenie nie jest jeszcze sparowane."
            return
        }
        status.text = "Sprawdzanie…"
        executor.execute {
            runCatching { api.get("/api/v1/status") }
                .onSuccess { result -> runOnUiThread {
                    status.text = "Control Service: online\nPi Engine: ${result.optString("engine", "unknown")}\n${api.baseUrl}"
                } }
                .onFailure { error -> runOnUiThread { status.text = "Mac jest nieosiągalny: ${error.message}" } }
        }
    }

    private fun openWebPanel(interactionId: String? = null) {
        if (!api.paired) {
            status.text = "Najpierw sparuj urządzenie."
            return
        }
        status.text = "Tworzenie bezpiecznego linku…"
        executor.execute {
            runCatching { api.createWebUrl(interactionId) }
                .onSuccess { url -> runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
                .onFailure { error -> runOnUiThread { status.text = "Nie udało się otworzyć panelu: ${error.message}" } }
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        }
    }
}
