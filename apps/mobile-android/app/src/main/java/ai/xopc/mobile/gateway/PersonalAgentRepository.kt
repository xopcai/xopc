package ai.xopc.mobile.gateway

import org.json.JSONObject

data class PersonalAgentRecord(val agentId: String, val conversationId: String,
  val state: String, val displayName: String, val appearance: String, val errorMessage: String?,
  val revision: Int = 0, val preferences: Map<String, String> = emptyMap(),
  val voicePreference: PersonalVoicePreference? = null)

data class PersonalVoicePreference(val provider: String, val model: String, val voice: String)
data class PersonalVoiceOption(val id: String, val name: String)
data class PersonalVoiceChoices(val provider: String, val model: String,
  val voices: List<PersonalVoiceOption>)

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

  fun updateProfile(record: PersonalAgentRecord, name: String, appearance: String,
    preferences: Map<String, String>, voice: PersonalVoicePreference? = record.voicePreference): PersonalAgentRecord {
    require(record.revision > 0 && name.isNotBlank() && name.length <= 60) { "INVALID_PERSONAL_PROFILE" }
    val body = JSONObject().put("revision", record.revision).put("displayName", name)
      .put("appearance", appearance).put("preferences", JSONObject(preferences))
      .put("voicePreference", voice?.let {
        JSONObject().put("provider", it.provider).put("model", it.model).put("voice", it.voice)
      } ?: JSONObject.NULL)
    return requireNotNull(parse(gateway.request("/api/personal-agent/profile", "PATCH", body.toString()))) {
      "PERSONAL_AGENT_UNAVAILABLE"
    }
  }

  fun voiceChoices(): PersonalVoiceChoices? {
    val status = JSONObject(gateway.request("/api/voice/realtime/status"))
    val route = status.optJSONObject("payload")?.optJSONObject("tts") ?: return null
    val provider = route.optString("provider").takeIf { it.isNotBlank() } ?: return null
    val model = route.optString("model").takeIf { it.isNotBlank() } ?: return null
    val query = "provider=${java.net.URLEncoder.encode(provider, "UTF-8")}" +
      "&model=${java.net.URLEncoder.encode(model, "UTF-8")}&purpose=realtime"
    val response = JSONObject(gateway.request("/api/voice/tts-voices?$query"))
    require(response.optBoolean("ok")) { "PERSONAL_VOICE_UNAVAILABLE" }
    val voices = response.optJSONObject("payload")?.optJSONArray("voices") ?: return PersonalVoiceChoices(
      provider, model, emptyList())
    return PersonalVoiceChoices(provider, model, (0 until voices.length()).mapNotNull { index ->
      voices.optJSONObject(index)?.let { voice ->
        val id = voice.optString("id")
        if (id.isBlank()) null else PersonalVoiceOption(id, voice.optString("name").ifBlank { id })
      }
    })
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
      val preferences = payload.optJSONObject("preferences")?.let { values ->
        values.keys().asSequence().associateWith { values.optString(it) }
      } ?: emptyMap()
      val voice = payload.optJSONObject("voicePreference")?.let {
        PersonalVoicePreference(it.optString("provider"), it.optString("model"), it.optString("voice"))
      }
      return PersonalAgentRecord(agentId, conversationId, state,
        payload.optString("displayName").ifBlank { "Ada" },
        payload.optString("appearance").ifBlank { "loopi" },
        payload.optString("errorMessage").takeIf { !payload.isNull("errorMessage") && it.isNotBlank() },
        payload.optInt("revision"), preferences, voice)
    }
  }
}
