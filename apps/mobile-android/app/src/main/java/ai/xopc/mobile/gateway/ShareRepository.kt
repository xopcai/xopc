package ai.xopc.mobile.gateway

import java.net.URI
import java.time.Instant
import org.json.JSONObject

data class ShareItem(val id: String, val kind: String, val title: String, val url: String,
  val lanUrl: String?, val reachability: String, val hint: String, val expiresAt: String,
  val revoked: Boolean, val expired: Boolean) {
  val active: Boolean get() = !revoked && !expired
}

data class ShareExtension(val expiresAt: String, val url: String)

/** Authenticated Gateway share management. No server mutation is inferred from a failed request. */
class ShareRepository(private val gateway: GatewaySession) {
  fun list(): List<ShareItem> = parseList(gateway.request("/api/shares"))

  fun revoke(id: String) {
    requireValidId(id)
    require(JSONObject(gateway.request("/api/shares/$id", "DELETE")).optBoolean("ok")) {
      "SHARE_REVOKE_UNCONFIRMED"
    }
  }

  fun extend(item: ShareItem, days: Int): ShareExtension {
    requireValidId(item.id)
    require(item.active && days in setOf(1, 3, 7)) { "INVALID_SHARE_EXTENSION" }
    val ttlMs = days * 86_400_000L
    val body = JSONObject().put("extendTtlMs", ttlMs).toString()
    val envelope = JSONObject(gateway.request("/api/shares/${item.id}", "PATCH", body))
    require(envelope.optBoolean("ok")) { "SHARE_EXTENSION_UNCONFIRMED" }
    val payload = envelope.getJSONObject("payload")
    val expiresAt = payload.getString("expiresAt")
    val url = payload.getString("shareUrl")
    require(payload.getString("id") == item.id && validUrl(url) &&
      Instant.parse(expiresAt).isAfter(Instant.now())) {
      "SHARE_EXTENSION_UNCONFIRMED"
    }
    return ShareExtension(expiresAt, url)
  }

  companion object {
    private val idPattern = Regex("[A-Za-z0-9_-]{1,128}")
    private val kinds = setOf("file", "directory", "site", "zip", "note", "session")
    private val reachabilities = setOf("public", "lan", "local-only")

    private fun requireValidId(id: String) = require(id.matches(idPattern)) { "INVALID_SHARE_ID" }

    private fun validUrl(value: String): Boolean = try {
      val uri = URI(value)
      value.length <= 4096 && uri.scheme in setOf("http", "https") &&
        !uri.host.isNullOrBlank() && uri.userInfo == null
    } catch (_: Exception) { false }

    fun parseList(raw: String): List<ShareItem> {
      val envelope = JSONObject(raw)
      require(envelope.optBoolean("ok")) { "INVALID_SHARE_LIST" }
      val rows = envelope.getJSONObject("payload").getJSONArray("shares")
      require(rows.length() <= 5000) { "SHARE_LIST_TOO_LARGE" }
      return (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        val id = row.getString("id")
        val kind = row.getString("kind")
        val title = row.getString("fileName")
        val url = row.getString("shareUrl")
        val reachability = row.getString("reachability")
        val expiresAt = row.getString("expiresAt")
        val lanUrl = if (row.isNull("lanUrl")) null else row.getString("lanUrl")
        requireValidId(id)
        require(kind in kinds && title.length in 1..1000 && validUrl(url) &&
          reachability in reachabilities && (lanUrl == null || validUrl(lanUrl))) {
          "INVALID_SHARE_ITEM"
        }
        Instant.parse(expiresAt)
        ShareItem(id, kind, title, url, lanUrl, reachability,
          if (row.isNull("reachabilityHint")) "" else row.getString("reachabilityHint").take(500), expiresAt,
          row.getBoolean("revoked"), row.getBoolean("expired"))
      }
    }
  }
}
