package pl.michalkozinski.piremote

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager

class PiMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val data = Data.Builder().putString("token", token).build()
        WorkManager.getInstance(this).enqueue(OneTimeWorkRequestBuilder<FcmTokenWorker>().setInputData(data).build())
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val eventId = message.data["eventId"] ?: return
        val data = Data.Builder().putString("eventId", eventId).build()
        val request = OneTimeWorkRequestBuilder<RemoteEventWorker>()
            .setInputData(data)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(this).enqueue(request)
    }
}
