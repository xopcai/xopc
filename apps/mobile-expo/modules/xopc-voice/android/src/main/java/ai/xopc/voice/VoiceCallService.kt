package ai.xopc.voice

import android.app.*
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager

class VoiceCallService : Service() {
  companion object { var onStop: (() -> Unit)? = null }
  private var wakeLock: PowerManager.WakeLock? = null
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "stop") { onStop?.invoke(); stopSelf(); return START_NOT_STICKY }
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
      wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "xopc:voice").apply { acquire(60 * 60 * 1000L) }
    }
    return START_NOT_STICKY
  }
  override fun onDestroy() {
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }
}
