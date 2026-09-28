package pl.michalkozinski.piremote

import android.app.Application

class PiRemoteApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
    }
}
