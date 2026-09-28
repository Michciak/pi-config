package pl.michalkozinski.piremote

import android.content.Context
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID

class DeviceIdentity(private val context: Context) {
    private val alias = "pi-remote-device"
    private val prefs = context.getSharedPreferences("pi-remote", Context.MODE_PRIVATE)
    val deviceId: String = prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also {
        prefs.edit().putString("deviceId", it).apply()
    }

    init { ensureKey() }

    fun publicKey(): String {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return Base64.encodeToString(keyStore.getCertificate(alias).publicKey.encoded, Base64.NO_WRAP)
    }

    fun sign(value: ByteArray): String {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(keyStore.getKey(alias, null) as java.security.PrivateKey)
        signature.update(value)
        return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }

    private fun ensureKey() {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keyStore.containsAlias(alias)) return
        val generator = KeyPairGenerator.getInstance("EC", "AndroidKeyStore")
        val spec = android.security.keystore.KeyGenParameterSpec.Builder(
            alias,
            android.security.keystore.KeyProperties.PURPOSE_SIGN or android.security.keystore.KeyProperties.PURPOSE_VERIFY,
        ).setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
            .build()
        generator.initialize(spec)
        generator.generateKeyPair()
    }
}
