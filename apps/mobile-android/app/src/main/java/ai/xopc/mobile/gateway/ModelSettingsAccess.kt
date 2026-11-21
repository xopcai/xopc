package ai.xopc.mobile.gateway

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import org.json.JSONArray
import org.json.JSONObject

data class SettingsModel(val ref: String, val name: String, val provider: String,
  val displayNames: Map<String, String> = emptyMap()) {
  fun localizedName(language: String): String = displayNames[if (language == "zh") "zh-CN" else "en"] ?: name
}
data class SettingsModelRoute(val key: String, val pool: String, val ref: String?, val name: String?,
  val inherited: Boolean, val allowInherit: Boolean)
data class ModelSettingsSnapshot(val revision: String, val routing: List<SettingsModelRoute>,
  val tasks: List<SettingsModelRoute>, val fallbacks: List<SettingsModel>, val pools: Map<String, List<SettingsModel>>)

class ModelSettingsAccess internal constructor(private val gateway: GatewaySession) {
  suspend fun load(gatewayId: String): ModelSettingsSnapshot = request(gatewayId)

  suspend fun select(gatewayId: String, revision: String, task: Boolean, key: String, ref: String?): ModelSettingsSnapshot =
    request(gatewayId, JSONObject().put("kind", if (task) "task" else "model").put("key", key)
      .put("ref", ref ?: JSONObject.NULL).put("revision", revision))

  suspend fun fallbacks(gatewayId: String, revision: String, refs: List<String>): ModelSettingsSnapshot =
    request(gatewayId, JSONObject().put("kind", "fallbacks").put("refs", JSONArray(refs)).put("revision", revision))

  private suspend fun request(gatewayId: String, body: JSONObject? = null): ModelSettingsSnapshot = runInterruptible(Dispatchers.IO) {
    val raw = gateway.request("/api/mobile/model-settings", if (body == null) "GET" else "PATCH",
      body?.toString().orEmpty(), expectedGatewayId = gatewayId)
    val data = JSONObject(raw).getJSONObject("payload")
    val pools = data.getJSONObject("pools")
    ModelSettingsSnapshot(data.getString("revision"), data.getJSONArray("routing").objects().map(::route),
      data.getJSONArray("tasks").objects().map(::route), data.getJSONArray("fallbacks").objects().map(::option),
      pools.keys().asSequence().associateWith { pools.getJSONArray(it).objects().map(::option) })
  }

  private fun route(value: JSONObject) = SettingsModelRoute(value.getString("key"), value.getString("pool"),
    value.nullable("ref"), value.nullable("name"), value.optBoolean("inherited"), value.optBoolean("allowInherit"))

  private fun option(value: JSONObject) = SettingsModel(value.getString("ref"), value.getString("name"),
    value.getString("provider"), value.modelDisplayNames())

  private fun JSONObject.nullable(name: String) = if (isNull(name)) null else getString(name)

  private fun JSONArray.objects() = List(length()) { getJSONObject(it) }
}
