package pl.michalkozinski.piremote

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Notifications {
    const val ATTENTION_CHANNEL = "pi-attention"
    const val STATUS_CHANNEL = "pi-status"
    const val EXTRA_OPEN_WEB = "openWeb"
    const val EXTRA_INTERACTION_ID = "interactionId"
    const val EXTRA_DECISION = "decision"

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(listOf(
            NotificationChannel(ATTENTION_CHANNEL, "Pytania i zatwierdzenia", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(STATUS_CHANNEL, "Stan Pi Engine", NotificationManager.IMPORTANCE_DEFAULT),
        ))
    }

    fun question(context: Context, id: String, sessionId: String?) {
        val open = PendingIntent.getActivity(context, id.hashCode(), Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_OPEN_WEB, true)
            putExtra(EXTRA_INTERACTION_ID, id)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        notify(context, id, NotificationCompat.Builder(context, ATTENTION_CHANNEL)
            .setSmallIcon(R.drawable.ic_pi)
            .setContentTitle("Pi czeka na odpowiedź")
            .setContentText(sessionId?.let { "Sesja $it" } ?: "Dotknij, aby otworzyć formularz")
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build())
    }

    fun approval(context: Context, id: String, title: String, message: String) {
        fun decision(value: String, requestCode: Int) = PendingIntent.getBroadcast(context, requestCode,
            Intent(context, ApprovalReceiver::class.java).apply {
                putExtra(EXTRA_INTERACTION_ID, id)
                putExtra(EXTRA_DECISION, value)
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(context, id.hashCode(), Intent(context, MainActivity::class.java).apply {
            putExtra(EXTRA_OPEN_WEB, true)
            putExtra(EXTRA_INTERACTION_ID, id)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        notify(context, id, NotificationCompat.Builder(context, ATTENTION_CHANNEL)
            .setSmallIcon(R.drawable.ic_pi)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(open)
            .addAction(0, "Odrzuć", decision("reject", id.hashCode() xor 1))
            .addAction(0, "Zatwierdź", decision("approve", id.hashCode() xor 2))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build())
    }

    fun engine(context: Context, status: String) {
        notify(context, "engine", NotificationCompat.Builder(context, STATUS_CHANNEL)
            .setSmallIcon(R.drawable.ic_pi)
            .setContentTitle("Pi Engine")
            .setContentText(status)
            .setAutoCancel(true)
            .build())
    }

    fun test(context: Context, title: String, message: String) {
        notify(context, "notification-test", NotificationCompat.Builder(context, ATTENTION_CHANNEL)
            .setSmallIcon(R.drawable.ic_pi)
            .setContentTitle(title)
            .setContentText(message)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build())
    }

    private fun notify(context: Context, id: String, notification: android.app.Notification) {
        runCatching { NotificationManagerCompat.from(context).notify(id.hashCode(), notification) }
    }
}
