package pl.michalkozinski.piremote

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class RemoteEventWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val eventId = inputData.getString("eventId") ?: return Result.failure()
        return runCatching {
            val api = ApiClient(applicationContext)
            val event = api.get("/api/v1/events/$eventId")
            val type = event.getString("type")
            val payload = event.optJSONObject("payload") ?: org.json.JSONObject()
            when (type) {
                "approval.created" -> {
                    val id = payload.getString("id")
                    Notifications.approval(applicationContext, id,
                        payload.optString("title", "Pi prosi o zatwierdzenie"), payload.optString("message"))
                }
                "engine.status_changed" -> {
                    Notifications.engine(applicationContext, payload.optString("status", "unknown"))
                }
                "user_question.created" -> Notifications.question(applicationContext,
                    payload.getString("id"), payload.optString("sessionId", null))
            }
        }.fold(onSuccess = { Result.success() }, onFailure = { if (runAttemptCount < 3) Result.retry() else Result.failure() })
    }
}
