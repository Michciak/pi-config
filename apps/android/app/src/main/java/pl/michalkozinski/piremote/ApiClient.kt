package pl.michalkozinski.piremote

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

class ApiClient(private val context: Context) {
    private val prefs = context.getSharedPreferences("pi-remote", Context.MODE_PRIVATE)
    private val identity = DeviceIdentity(context)
    val paired: Boolean get() = prefs.contains("baseUrl")
    val baseUrl: String get() = prefs.getString("baseUrl", "")!!.trimEnd('/')

    fun pair(host: String, port: Int, code: String, fcmToken: String?): JSONObject {
        val url = "http://$host:$port"
        val body = sortedJson(mapOf(
            "code" to code,
            "deviceId" to identity.deviceId,
            "name" to "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            "publicKey" to identity.publicKey(),
            "fcmToken" to fcmToken,
        ))
        val result = request("$url/api/v1/devices/pair", "POST", body, signed = false)
        prefs.edit().putString("baseUrl", url).apply()
        return result
    }

    fun get(path: String): JSONObject = request("$baseUrl$path", "GET", null, true)
    fun post(path: String, fields: Map<String, Any?> = emptyMap()): JSONObject =
        request("$baseUrl$path", "POST", sortedJson(fields), true)

    fun updateFcmToken(token: String) {
        if (paired) post("/api/v1/devices/${identity.deviceId}/fcm-token", mapOf("token" to token))
    }

    fun createWebUrl(interactionId: String? = null): String = post(
        "/api/v1/devices/${identity.deviceId}/web-token",
        if (interactionId == null) emptyMap() else mapOf("interactionId" to interactionId),
    ).getString("url")

    private fun request(url: String, method: String, body: String?, signed: Boolean): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 5_000
        connection.readTimeout = 10_000
        connection.setRequestProperty("content-type", "application/json")
        if (signed) {
            val timestamp = System.currentTimeMillis().toString()
            val nonce = UUID.randomUUID().toString()
            val path = URL(url).path
            val bodyHash = sha256(body ?: "")
            val canonical = "$timestamp\n$nonce\n$method\n$path\n$bodyHash"
            connection.setRequestProperty("x-pi-device", identity.deviceId)
            connection.setRequestProperty("x-pi-timestamp", timestamp)
            connection.setRequestProperty("x-pi-nonce", nonce)
            connection.setRequestProperty("x-pi-signature", identity.sign(canonical.toByteArray()))
        }
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray()) }
        }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
        if (connection.responseCode !in 200..299) throw ApiException(
            connection.responseCode,
            JSONObject(text).optString("error", "HTTP ${connection.responseCode}"),
        )
        return JSONObject(text)
    }

    private fun sortedJson(values: Map<String, Any?>): String {
        val keys = values.keys.sorted()
        return keys.joinToString(prefix = "{", postfix = "}", separator = ",") { key ->
            JSONObject.quote(key) + ":" + jsonValue(values[key])
        }
    }

    private fun jsonValue(value: Any?): String = when (value) {
        null -> "null"
        is String -> JSONObject.quote(value)
        is Boolean, is Number -> value.toString()
        is Map<*, *> -> sortedJson(value.entries.associate { it.key.toString() to it.value })
        is List<*> -> value.joinToString(prefix = "[", postfix = "]") { jsonValue(it) }
        else -> JSONObject.quote(value.toString())
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}

class ApiException(val statusCode: Int, message: String) : IllegalStateException(message)
