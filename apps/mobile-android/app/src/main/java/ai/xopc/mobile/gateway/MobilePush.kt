package ai.xopc.mobile.gateway

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ai.xopc.mobile.MainActivity
import ai.xopc.mobile.R
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal const val pushRouteExtra = "xopc_route"
private const val channelId = "xopc_updates"

internal data class MobilePushClick(val gatewayId: String, val eventId: String) {
  companion object {
    private val id = Regex("[A-Za-z0-9_.:-]{1,160}")

    fun decode(value: String): MobilePushClick? = runCatching {
      require(value.length <= 6_000)
      val route = JSONObject(String(Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8))
      val gateway = route.getString("gatewayId")
      val event = route.getString("eventId")
      require(id.matches(gateway) && id.matches(event))
      MobilePushClick(gateway, event)
    }.getOrNull()
  }
}

internal object MobilePushInbox {
  private const val key = "pending_clicks"
  private fun preferences(context: Context) = context.getSharedPreferences("mobile_push", Context.MODE_PRIVATE)
  private val changes = MutableStateFlow(0)
  val revision = changes.asStateFlow()
  private val tokenChanges = MutableStateFlow(0)
  val tokenRevision = tokenChanges.asStateFlow()

  @Synchronized fun pending(context: Context): List<String> {
    val saved = preferences(context).getString(key, null) ?: return emptyList()
    return runCatching {
      val items = JSONArray(saved)
      List(items.length()) { items.getString(it) }
    }.getOrDefault(emptyList())
  }

  @Synchronized fun receive(context: Context, route: String) {
    if (MobilePushClick.decode(route) == null) return
    val old = pending(context)
    if (route !in old) write(context, (old + route).takeLast(32))
  }

  @Synchronized fun forget(context: Context, route: String) = write(context, pending(context) - route)

  private fun write(context: Context, pending: List<String>) {
    preferences(context).edit().putString(key, JSONArray(pending).toString()).apply()
    changes.value++
  }

  @Synchronized fun tokenChanged() { tokenChanges.value++ }
}

internal class MobilePushClient(private val context: Context, private val session: GatewaySession) {
  private val preferences = context.getSharedPreferences("mobile_push", Context.MODE_PRIVATE)
  private val operations = Mutex()
  private val mutableEnabled = MutableStateFlow<Set<String>>(emptySet())
  val enabled = mutableEnabled.asStateFlow()
  private val recent = mutableMapOf<String, Pair<Int, Long>>()

  private fun key(profile: GatewayProfile) = "enabled.${profile.gatewayId}.${profile.deviceId}"
  fun scope(profile: GatewayProfile) = key(profile)

  suspend fun restore(profile: GatewayProfile, revision: Int) {
    operations.withLock {
      if (!preferences.getBoolean(key(profile), false)) return
      val prior = recent[key(profile)]
      if (prior != null && prior.first == revision && System.currentTimeMillis() - prior.second < 3_600_000 &&
        NotificationManagerCompat.from(context).areNotificationsEnabled()) return
      sync(profile, revision)
    }
  }

  suspend fun setEnabled(profile: GatewayProfile, enabled: Boolean, revision: Int) {
    operations.withLock {
      if (enabled) {
        check(NotificationManagerCompat.from(context).areNotificationsEnabled()) { "PUSH_PERMISSION_DENIED" }
        sync(profile, revision)
        preferences.edit().putBoolean(key(profile), true).apply()
      } else {
        remove(profile)
        preferences.edit().remove(key(profile)).apply()
      }
    }
  }

  private suspend fun sync(profile: GatewayProfile, revision: Int) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
      remove(profile)
      return
    }
    withContext(Dispatchers.IO) {
      check(FirebaseApp.getApps(context).isNotEmpty()) { "PUSH_NOT_CONFIGURED" }
      val messaging = FirebaseMessaging.getInstance()
      val token = Tasks.await(messaging.token, 12, TimeUnit.SECONDS)
      val body = JSONObject().put("platform", "android").put("pushToken", token).put("permissions", "granted")
        .put("locale", if (ai.xopc.mobile.theme.LanguagePreference.read(context).startsWith("zh") ||
          ai.xopc.mobile.theme.LanguagePreference.read(context) == "system" &&
          context.resources.configuration.locales[0].language == "zh") "zh" else "en")
      session.request("/api/devices/me/push", "PUT", body.toString(), expectedGatewayId = profile.gatewayId)
      messaging.isAutoInitEnabled = true
    }
    recent[key(profile)] = revision to System.currentTimeMillis()
    mutableEnabled.value += key(profile)
  }

  private suspend fun remove(profile: GatewayProfile) {
    withContext(Dispatchers.IO) {
      session.request("/api/devices/me/push", "DELETE", expectedGatewayId = profile.gatewayId)
    }
    recent.remove(key(profile))
    mutableEnabled.value -= key(profile)
  }

  suspend fun acknowledge(click: MobilePushClick): JSONObject? = withContext(Dispatchers.IO) {
    JSONObject(session.request("/api/notifications/${click.eventId}/ack", "POST",
      """{"surface":"mobile"}""", expectedGatewayId = click.gatewayId)).optJSONObject("target")
  }
}

internal fun createPushChannel(context: Context) {
  val manager = context.getSystemService(NotificationManager::class.java)
  manager.createNotificationChannel(NotificationChannel(channelId, context.getString(R.string.push_title),
    NotificationManager.IMPORTANCE_DEFAULT))
}

class XopcFirebaseMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    MobilePushInbox.tokenChanged()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val route = message.data[pushRouteExtra] ?: return
    val click = MobilePushClick.decode(route) ?: return
    val alert = message.notification ?: return
    createPushChannel(this)
    val manager = NotificationManagerCompat.from(this)
    if (!manager.areNotificationsEnabled()) return
    val intent = Intent(this, MainActivity::class.java).setAction(Intent.ACTION_MAIN)
      .putExtra(pushRouteExtra, route)
    val id = (click.gatewayId + ":" + click.eventId).hashCode()
    val open = PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, channelId).setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(alert.title).setContentText(alert.body).setAutoCancel(true).setContentIntent(open).build()
    try { manager.notify(id, notification) } catch (_: SecurityException) { }
  }
}
