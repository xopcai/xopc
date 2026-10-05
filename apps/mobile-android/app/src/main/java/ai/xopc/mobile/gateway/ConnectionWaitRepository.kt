package ai.xopc.mobile.gateway

import org.json.JSONObject

data class ConnectionWaitNeed(val key: String, val label: String, val phase: String,
  val authorizationMode: String, val capabilities: List<String>, val reason: String?)

data class ConnectionWaitInfo(val id: String, val conversationId: String, val version: Long,
  val phase: String, val summary: String, val needs: List<ConnectionWaitNeed>,
  val timeRange: String?)

data class ConnectionWaitSnapshot(val transcriptId: String, val revision: Long,
  val wait: ConnectionWaitInfo?)

class ConnectionWaitRepository(private val gateway: GatewaySession) {
  fun snapshot(conversationId: String): ConnectionWaitSnapshot {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_CONVERSATION_ID" }
    return parseSnapshot(conversationId,
      gateway.request("/api/sessions/$conversationId/connection-wait"))
  }

  companion object {
    fun parseSnapshot(conversationId: String, raw: String): ConnectionWaitSnapshot {
      val response = JSONObject(raw)
      require(response.optBoolean("ok")) { "INVALID_CONNECTION_WAIT" }
      val payload = response.getJSONObject("payload")
      val transcriptId = payload.getString("transcriptId")
      val revision = payload.getLong("revision")
      require(transcriptId.isNotBlank() && transcriptId.length <= 256 && revision >= 0) {
        "INVALID_CONNECTION_WAIT"
      }
      val wait = payload.optJSONObject("wait")?.let { row ->
        val id = row.getString("id")
        val owner = row.getString("conversationId")
        val version = row.getLong("version")
        val phase = row.getString("phase")
        val summary = row.getString("summary")
        val needs = row.getJSONArray("needs")
        require(id.isNotBlank() && id.length <= 256 && owner == conversationId && version > 0 &&
          phase in setOf("needs_connection", "ready", "review_scope", "queued") &&
          summary.isNotBlank() && summary.length <= 4_000 && needs.length() <= 20) {
          "INVALID_CONNECTION_WAIT"
        }
        val parsedNeeds = (0 until needs.length()).map { index ->
          val need = needs.getJSONObject(index)
          val key = need.getString("key")
          val label = need.getString("label")
          val needPhase = need.getString("phase")
          val mode = need.getString("authorizationMode")
          val capabilities = need.getJSONArray("capabilities")
          require(key.isNotBlank() && key.length <= 256 && label.isNotBlank() && label.length <= 240 &&
            needPhase in setOf("install", "connect", "authorizing", "reconnect", "choose_account", "ready", "blocked") &&
            mode in setOf("browser", "desktop") && capabilities.length() <= 20) {
            "INVALID_CONNECTION_WAIT"
          }
          ConnectionWaitNeed(key, label, needPhase, mode,
            (0 until capabilities.length()).map { capabilityIndex ->
              capabilities.getString(capabilityIndex).take(160)
            }, need.optString("reason").takeIf(String::isNotBlank)?.take(500))
        }
        val timeRange = row.optJSONObject("timeRange")?.let { range ->
          listOf(range.optString("expression"), range.optString("timezone"))
            .filter(String::isNotBlank).joinToString(" · ").take(240).takeIf(String::isNotBlank)
        }
        ConnectionWaitInfo(id, owner, version, phase, summary, parsedNeeds, timeRange)
      }
      return ConnectionWaitSnapshot(transcriptId, revision, wait)
    }
  }
}
