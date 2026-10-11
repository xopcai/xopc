package ai.xopc.mobile.gateway

import android.Manifest
import android.app.AlertDialog
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal object DeviceLocation {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val jobs = mutableMapOf<String, Job>()
  private var activity: ComponentActivity? = null
  private var launcher: ActivityResultLauncher<Array<String>>? = null
  private var permission: CompletableDeferred<Unit>? = null
  fun attach(owner: ComponentActivity, requests: ActivityResultLauncher<Array<String>>) { activity = owner; launcher = requests }
  fun detach(owner: ComponentActivity) { if (activity === owner) { cancelAll(); activity = null; launcher = null } }
  fun permissionsChanged() { permission?.complete(Unit); permission = null }
  fun cancel(id: String) { scope.launch { jobs.remove(id)?.cancel() } }
  fun cancelAll() { scope.launch { jobs.values.toList().forEach { it.cancel() }; jobs.clear(); permission?.cancel() } }

  fun invoke(request: JSONObject, send: (String, JSONObject) -> Unit) {
    val id = request.getString("invocationId")
    fun fail(code: String) { send("tool.error", JSONObject().put("invocationId", id).put("code", code).put("message", "Location request failed: $code")) }
    val args = request.optJSONObject("arguments")
    val purpose = args?.optString("purpose")
    val precision = args?.optString("precision")
    val category = args?.optString("category")
    if (request.optString("descriptorRevision") != DeviceToolCatalog.revisions[2]) { fail("TOOL_REVISION_MISMATCH"); return }
    if (!request.optBoolean("confirmationRequired") || purpose !in listOf("weather", "nearby")
      || precision !in listOf("approximate", "precise") || args == null || args.length() != (if (purpose == "weather") 2 else 3)
      || (purpose == "nearby" && category !in listOf("restaurant", "cafe", "pharmacy", "park"))) { fail("INVALID_ARGUMENTS"); return }
    val remaining = request.optLong("deadlineAt") - System.currentTimeMillis()
    if (remaining <= 0) { fail("TOOL_TIMEOUT"); return }
    send("tool.received", JSONObject().put("invocationId", id))
    scope.launch {
      if (jobs.isNotEmpty() || permission != null) { fail("TOOL_BUSY"); return@launch }
      val job = launch(start = CoroutineStart.LAZY) {
        try {
          val value = withTimeout(remaining) {
            val owner = activity ?: throw LocationFailure("ENDPOINT_NOT_FOREGROUND")
            if (owner.isFinishing || owner.isDestroyed) throw LocationFailure("ENDPOINT_NOT_FOREGROUND")
            val service = if (purpose == "weather") "Open-Meteo" else "OpenStreetMap"
            val text = "使用此手机的${if (precision == "precise") "精确" else "大致"}位置，${if (purpose == "weather") "查询天气" else "查询附近地点"}。\n坐标将发送给 $service，仅用于本次查询，原始坐标不进入聊天历史。"
            val allowed = suspendCancellableCoroutine<Boolean> { continuation ->
              val dialog = AlertDialog.Builder(owner).setTitle("允许本次使用位置？").setMessage(text)
                .setNegativeButton("拒绝") { _, _ -> if (continuation.isActive) continuation.resume(false) }
                .setPositiveButton("允许一次") { _, _ -> if (continuation.isActive) continuation.resume(true) }
                .setOnCancelListener { if (continuation.isActive) continuation.resume(false) }.create()
              continuation.invokeOnCancellation { owner.runOnUiThread { dialog.dismiss() } }; dialog.show()
            }
            if (!allowed) throw LocationFailure("USER_DENIED")
            if (activity !== owner) throw LocationFailure("ENDPOINT_NOT_FOREGROUND")
            val coarse = Manifest.permission.ACCESS_COARSE_LOCATION
            val fine = Manifest.permission.ACCESS_FINE_LOCATION
            fun granted(name: String) = ContextCompat.checkSelfPermission(owner, name) == PackageManager.PERMISSION_GRANTED
            if (!granted(coarse) || (precision == "precise" && !granted(fine))) {
              val waiting = CompletableDeferred<Unit>(); permission = waiting
              val requests = launcher ?: run { permission = null; throw LocationFailure("ENDPOINT_NOT_FOREGROUND") }
              try { requests.launch(if (precision == "precise") arrayOf(fine, coarse) else arrayOf(coarse)) }
              catch (error: Exception) { permission = null; throw error }
              waiting.await()
            }
            if (!granted(coarse) && !granted(fine)) throw LocationFailure("PERMISSION_DENIED")
            if (activity !== owner) throw LocationFailure("ENDPOINT_NOT_FOREGROUND")
            val manager = owner.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
              .firstOrNull { manager.isProviderEnabled(it) } ?: throw LocationFailure("PERMISSION_DENIED")
            val sample = withTimeout(20_000) { sample(manager, provider, owner) }
            if (sample.time < System.currentTimeMillis() - 30_000 || sample.accuracy < 0) throw LocationFailure("PROTOCOL_ERROR")
            if (!granted(coarse) && !granted(fine)) throw LocationFailure("PERMISSION_DENIED")
            if (activity !== owner) throw LocationFailure("ENDPOINT_NOT_FOREGROUND")
            val approximate = precision == "approximate" || !granted(fine) || sample.accuracy > 1000
            JSONObject().put("latitude", if (approximate) kotlin.math.round(sample.latitude * 50) / 50 else sample.latitude)
              .put("longitude", if (approximate) kotlin.math.round(sample.longitude * 50) / 50 else sample.longitude)
              .put("accuracyMeters", if (approximate) maxOf(3000.0, sample.accuracy.toDouble()) else sample.accuracy.toDouble())
              .put("capturedAt", sample.time).put("coordinateSystem", "WGS84")
              .put("precision", if (approximate) "approximate" else "precise")
          }
          send("tool.result", JSONObject().put("invocationId", id).put("content", JSONArray().put(JSONObject().put("type", "json").put("value", value))))
        } catch (_: TimeoutCancellationException) { fail("TOOL_TIMEOUT") }
        catch (_: CancellationException) { send("tool.cancelled", JSONObject().put("invocationId", id)) }
        catch (error: LocationFailure) { fail(error.code) }
        catch (_: SecurityException) { fail("PERMISSION_DENIED") }
        catch (_: Exception) { fail("PROTOCOL_ERROR") }
        finally { jobs.remove(id) }
      }
      jobs[id] = job; job.start()
    }
  }
  private suspend fun sample(manager: LocationManager, provider: String, owner: ComponentActivity): Location = suspendCancellableCoroutine { continuation ->
    if (Build.VERSION.SDK_INT >= 30) {
      val cancellation = CancellationSignal(); continuation.invokeOnCancellation { cancellation.cancel() }
      manager.getCurrentLocation(provider, cancellation, owner.mainExecutor) { location ->
        if (continuation.isActive) { if (location != null) continuation.resume(location) else continuation.resumeWithException(LocationFailure("PROTOCOL_ERROR")) }
      }
    } else {
      val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) { manager.removeUpdates(this); if (continuation.isActive) continuation.resume(location) }
        override fun onProviderDisabled(provider: String) { manager.removeUpdates(this); if (continuation.isActive) continuation.resumeWithException(LocationFailure("PERMISSION_DENIED")) }
        override fun onProviderEnabled(provider: String) {}
        @Deprecated("Legacy provider callback") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
      }
      continuation.invokeOnCancellation { manager.removeUpdates(listener) }
      @Suppress("DEPRECATION") manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
    }
  }
  private class LocationFailure(val code: String) : Exception(code)
}
