package ai.xopc.voice

import android.app.*
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager

class VoiceCallService : Service() {
  companion object {
    private val callbackLock = Any()
    private var callback: (() -> Unit)? = null
    var onStop: (() -> Unit)?
      get() = synchronized(callbackLock) { callback }
      set(value) { synchronized(callbackLock) { callback = value } }
    private fun takeStop(expected: (() -> Unit)?): (() -> Unit)? = synchronized(callbackLock) {
      if (callback !== expected) null else callback.also { callback = null }
    }
  }
  private var sessionStop: (() -> Unit)? = null
  private var wakeLock: PowerManager.WakeLock? = null
  override fun onBind(intent: Intent?): IBinder? = null
  @android.annotation.SuppressLint("WakelockTimeout")
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "stop") { try { takeStop(sessionStop)?.invoke() } finally { stopSelf() }; return START_NOT_STICKY }
    sessionStop = onStop
    val title = intent?.getStringExtra("title") ?: "XOPC"
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel("xopc-voice", title, NotificationManager.IMPORTANCE_LOW))
    val stop = PendingIntent.getService(this, 0, Intent(this, VoiceCallService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val notification = Notification.Builder(this, "xopc-voice")
      .setContentTitle(title).setSmallIcon(android.R.drawable.ic_btn_speak_now).setOngoing(true)
      .addAction(Notification.Action.Builder(null, intent?.getStringExtra("stopLabel") ?: "Stop", stop).build())
    if (launch != null) notification.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    startForeground(7341, notification.build())
    if (wakeLock == null) {
      wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "xopc:voice").apply { acquire() }
    }
    return START_NOT_STICKY
  }
  override fun onDestroy() {
    val stop = takeStop(sessionStop)
    try { stop?.invoke() } catch (error: Exception) { android.util.Log.w("XopcVoice", "Audio service stop failed", error) }
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }
}
