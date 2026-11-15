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
  val iconUrl: String? = null,
)

data class CapabilityPage(val items: List<CapabilityItem>, val incomplete: Boolean = false, val origin: String? = null)

internal class CapabilityRepository(private val gateway: GatewaySession) {
  fun panel(category: String, id: String, locale: String, command: JSONObject?): JSONObject {
    require(category in setOf("plugins", "skills", "connections", "agents", "channels"))
    val key = URLEncoder.encode(id, "UTF-8")
    val language = URLEncoder.encode(locale, "UTF-8")
    val path = "/api/capabilities/mobile-actions/panel/$category?id=$key&locale=$language"
    val response = JSONObject(gateway.request(path, if (command == null) "GET" else "POST", command?.toString().orEmpty()))
    check(response.optBoolean("ok")) { "CAPABILITY_SETUP_FAILED" }
    return response.getJSONObject("payload")
  }

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
        issue = row.optString("issue").takeIf(String::isNotBlank),
        iconUrl = (row.opt("iconUrl") as? String)?.takeIf(String::isNotBlank))
    }.distinctBy { it.id }, payload.optBoolean("incomplete"), gateway.currentProfile()?.let { profile ->
      profile.routes.firstOrNull { it.id == profile.activeRouteId }?.url
    })
  }
}
