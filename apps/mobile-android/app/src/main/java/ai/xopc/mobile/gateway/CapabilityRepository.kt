package ai.xopc.mobile.gateway

import java.net.URLEncoder
import org.json.JSONObject

data class CapabilityItem(
  val id: String,
  val name: String,
  val description: String = "",
  val group: String,
  val avatar: String? = null,
  val personal: Boolean = false,
  val targetId: String? = null,
  val version: String? = null,
  val issue: String? = null,
)

data class CapabilityPage(val items: List<CapabilityItem>, val incomplete: Boolean = false)

internal class CapabilityRepository(private val gateway: GatewaySession) {
  fun load(category: String, locale: String): CapabilityPage {
    require(category in setOf("plugins", "skills", "connections", "agents", "channels"))
    val language = URLEncoder.encode(locale, "UTF-8")
    val response = JSONObject(gateway.request("/api/capabilities/mobile-catalog?category=$category&locale=$language"))
    require(response.getBoolean("ok")) { "CAPABILITIES_NOT_AVAILABLE" }
    val payload = response.getJSONObject("payload")
    val rows = payload.getJSONArray("items")
    return CapabilityPage((0 until rows.length()).map { index ->
      val row = rows.getJSONObject(index)
      CapabilityItem(row.getString("id"), row.getString("name"), row.optString("description"),
        row.getString("group"), row.optString("avatar").takeIf(String::isNotBlank),
        targetId = row.optString("targetId").takeIf(String::isNotBlank),
        version = row.optString("version").takeIf(String::isNotBlank),
        issue = row.optString("issue").takeIf(String::isNotBlank))
    }.distinctBy { it.id }, payload.optBoolean("incomplete"))
  }
}
