package ai.xopc.mobile.gateway

import org.json.JSONObject

data class PersonalAgentRecord(val agentId: String, val conversationId: String,
  val state: String, val displayName: String, val appearance: String, val errorMessage: String?)

class PersonalAgentRepository(private val gateway: GatewaySession) {
  fun get(): PersonalAgentRecord? = parse(gateway.request("/api/personal-agent"))

  fun avatar(agent: PersonalAgentRecord): ByteArray? {
    if (agent.appearance != "custom") return null
    val id = java.net.URLEncoder.encode(agent.agentId, "UTF-8")
    val bytes = gateway.requestBytes("/api/agents/$id/avatar")
    require(bytes.size in 1..(512 * 1024)) { "INVALID_PERSONAL_AVATAR" }
    val valid = bytes.size >= 8 && bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() ||
      bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() &&
        bytes[2] == 0xff.toByte() ||
      bytes.size >= 12 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" &&
        String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP"
    require(valid) { "INVALID_PERSONAL_AVATAR" }
    return bytes
  }

  fun openOrCreate(): PersonalAgentRecord {
    val existing = get()
    if (existing?.state == "ready") return existing
    val created = parse(gateway.request("/api/personal-agent", "POST", "{}"))
    require(created?.state == "ready") { created?.errorMessage ?: "PERSONAL_AGENT_UNAVAILABLE" }
    return created
  }

  companion object {
    fun parse(raw: String): PersonalAgentRecord? {
      val response = JSONObject(raw)
      require(response.optBoolean("ok")) { response.optString("error", "PERSONAL_AGENT_UNAVAILABLE") }
      val payload = response.optJSONObject("payload") ?: return null
      val state = payload.getString("state")
      val agentId = payload.getString("agentId")
      val conversationId = payload.getString("conversationId")
      require(state in setOf("provisioning", "ready", "error") && agentId.isNotBlank() &&
        conversationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_PERSONAL_AGENT" }
      return PersonalAgentRecord(agentId, conversationId, state,
        payload.optString("displayName").ifBlank { "Ada" },
        payload.optString("appearance").ifBlank { "loopi" },
        payload.optString("errorMessage").takeIf { !payload.isNull("errorMessage") && it.isNotBlank() })
    }
  }
}
