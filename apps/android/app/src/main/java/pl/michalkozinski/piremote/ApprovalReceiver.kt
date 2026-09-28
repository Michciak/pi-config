package pl.michalkozinski.piremote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

class ApprovalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(Notifications.EXTRA_INTERACTION_ID) ?: return
        val decision = intent.getStringExtra(Notifications.EXTRA_DECISION) ?: return
        val data = Data.Builder().putString("id", id).putString("decision", decision).build()
        WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<DecisionWorker>().setInputData(data).build())
    }
}
