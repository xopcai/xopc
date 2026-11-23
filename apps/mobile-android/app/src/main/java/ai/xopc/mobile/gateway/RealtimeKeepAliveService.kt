package ai.xopc.mobile.gateway

import ai.xopc.mobile.MainActivity
import ai.xopc.mobile.R
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

internal object RealtimeKeepAliveController {
  @Volatile private var running = false

  fun start(context: Context) {
    if (running) return
    val app = context.applicationContext
    val started = runCatching {
      ContextCompat.startForegroundService(app, Intent(app, RealtimeKeepAliveService::class.java))
      true
    }.getOrDefault(false)
    if (started) running = true
  }

  fun stop(context: Context) {
    if (!running) return
    running = false
    val app = context.applicationContext
    runCatching { app.stopService(Intent(app, RealtimeKeepAliveService::class.java)) }
  }

  internal fun markStopped() {
    running = false
  }
}

class RealtimeKeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification()
    val started = runCatching {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
      true
    }.getOrDefault(false)
    if (!started) {
      RealtimeKeepAliveController.markStopped()
      stopSelf()
      return START_NOT_STICKY
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    RealtimeKeepAliveController.markStopped()
    super.onDestroy()
  }

  private fun ensureChannel() {
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.keepalive_channel_name),
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pending = PendingIntent.getActivity(
      this,
      NOTIFICATION_ID,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.brand_mark_monochrome)
      .setContentTitle(getString(R.string.keepalive_notification_title))
      .setContentText(getString(R.string.keepalive_notification_text))
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(pending)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "xopc_realtime_keepalive"
    private const val NOTIFICATION_ID = 4102
  }
}
