package pl.michalkozinski.piremote

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class DecisionWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val id = inputData.getString("id") ?: return Result.failure()
        val decision = inputData.getString("decision") ?: return Result.failure()
        return runCatching {
            ApiClient(applicationContext).post("/api/v1/approvals/$id/decision", mapOf("decision" to decision))
        }.fold(
            onSuccess = { Result.success() },
            onFailure = { failure ->
                if (failure is ApiException && failure.statusCode == 409) Result.success()
                else if (runAttemptCount < 3) Result.retry() else Result.failure()
            },
        )
    }
}
