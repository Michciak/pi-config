package pl.michalkozinski.piremote

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class FcmTokenWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val token = inputData.getString("token") ?: return Result.failure()
        val api = ApiClient(applicationContext)
        if (!api.paired) return Result.success()
        return runCatching { api.updateFcmToken(token) }
            .fold(onSuccess = { Result.success() }, onFailure = { if (runAttemptCount < 3) Result.retry() else Result.failure() })
    }
}
