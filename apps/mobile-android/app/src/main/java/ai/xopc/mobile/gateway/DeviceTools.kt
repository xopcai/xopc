package ai.xopc.mobile.gateway

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import java.util.Locale
import java.util.TimeZone
import org.json.JSONArray
import org.json.JSONObject

internal class DeviceTools(private val context: Context) {
  fun catalog(location: Boolean = false): JSONArray = JSONArray(if (location) DeviceToolCatalog.json else DeviceToolCatalog.stateJson)

  fun invoke(request: JSONObject, send: (String, JSONObject) -> Unit) {
    val id = request.getString("invocationId")
    fun fail(code: String) { send("tool.error", JSONObject().put("invocationId", id)
      .put("code", code).put("message", "Device reading unavailable: $code")) }
    if (request.optString("toolName") == "mobile.device.get_location") { DeviceLocation.invoke(request, send); return }
    val index = when (request.optString("toolName")) {
      "mobile.device.get_state" -> 0
      "mobile.device.get_power" -> 1
      else -> { fail("TOOL_NOT_FOUND"); return }
    }
    if (request.optString("descriptorRevision") != DeviceToolCatalog.revisions[index]) {
      fail("TOOL_REVISION_MISMATCH"); return
    }
    if (request.optBoolean("confirmationRequired") || request.optJSONObject("arguments")?.length() != 0) {
      fail("INVALID_ARGUMENTS"); return
    }
    if (request.optLong("deadlineAt") <= System.currentTimeMillis()) { fail("TOOL_TIMEOUT"); return }
    send("tool.received", JSONObject().put("invocationId", id))
    try {
      val value = JSONObject().put("capturedAt", System.currentTimeMillis())
      if (index == 0) value.put("platform", "android").put("systemVersion", Build.VERSION.RELEASE.take(80))
        .put("locale", Locale.getDefault().toLanguageTag().take(80)).put("timezone", TimeZone.getDefault().id.take(80))
      else {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val percent = if (level >= 0 && scale > 0 && level <= scale) 100.0 * level / scale else null
        val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = when (status) {
          BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
          BatteryManager.BATTERY_STATUS_DISCHARGING, BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
          else -> null
        }
        value.put("levelPercent", percent ?: JSONObject.NULL).put("charging", charging ?: JSONObject.NULL)
      }
      if (request.getLong("deadlineAt") <= System.currentTimeMillis()) { fail("TOOL_TIMEOUT"); return }
      send("tool.result", JSONObject().put("invocationId", id).put("content", JSONArray()
        .put(JSONObject().put("type", "json").put("value", value))))
    } catch (_: Exception) { fail("PERMISSION_DENIED") }
  }
}
