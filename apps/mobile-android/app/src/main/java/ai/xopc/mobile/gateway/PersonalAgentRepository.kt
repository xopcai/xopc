package ai.xopc.mobile.gateway

import org.json.JSONObject

data class PersonalAgentRecord(val agentId: String, val conversationId: String,
  val state: String, val displayName: String, val appearance: String, val errorMessage: String?,
  val revision: Int = 0, val preferences: Map<String, String> = emptyMap(),
  val voicePreference: PersonalVoicePreference? = null, val userCallName: String? = null)

data class PersonalVoicePreference(val provider: String, val model: String, val voice: String)
data class PersonalVoiceOption(val id: String, val name: String)
data class PersonalVoiceChoices(val provider: String, val model: String,
  val voices: List<PersonalVoiceOption>)

data class PersonalProactivitySettings(val revision: Int, val mode: String, val timezone: String,
  val quietStart: Int, val quietEnd: Int, val dailyMessages: Int, val dailyModelCalls: Int) {
  fun json(): JSONObject = JSONObject().put("revision", revision).put("mode", mode).put("timezone", timezone)
    .put("quietStart", quietStart).put("quietEnd", quietEnd).put("dailyMessages", dailyMessages)
    .put("dailyModelCalls", dailyModelCalls)
}

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

  fun proactivity(): PersonalProactivitySettings = parseProactivity(gateway.request("/api/personal-agent/proactivity"))

  fun updateProactivity(settings: PersonalProactivitySettings): PersonalProactivitySettings {
    require(settings.revision > 0 && settings.mode in setOf("off", "follow_up", "balanced") &&
      settings.quietStart in 0..23 && settings.quietEnd in 0..23 && settings.timezone.isNotBlank()) { "INVALID_PROACTIVITY_SETTINGS" }
    java.time.ZoneId.of(settings.timezone)
    return parseProactivity(gateway.request("/api/personal-agent/proactivity", "PATCH", settings.json().toString()))
  }

  fun uploadAvatar(bytes: ByteArray) {
    require(bytes.size in 1..(512 * 1024)) { "INVALID_PERSONAL_AVATAR" }
    val body = JSONObject().put("base64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
      .put("mimeType", "image/jpeg")
    val response = JSONObject(gateway.request("/api/personal-agent/avatar", "PUT", body.toString()))
    require(response.optBoolean("ok")) { "PERSONAL_AVATAR_UPLOAD_FAILED" }
  }

  companion object {
    fun parseProactivity(raw: String): PersonalProactivitySettings {
      val response = JSONObject(raw)
      require(response.optBoolean("ok")) { response.optString("error", "PERSONAL_AGENT_UNAVAILABLE") }
      val value = response.getJSONObject("payload")
      return PersonalProactivitySettings(value.getInt("revision"), value.getString("mode"), value.getString("timezone"),
        value.getInt("quietStart"), value.getInt("quietEnd"), value.getInt("dailyMessages"), value.getInt("dailyModelCalls"))
    }

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
        payload.optInt("revision"), preferences, voice, payload.optString("userCallName").takeIf { !payload.isNull("userCallName") && it.isNotBlank() })
    }
  }
}
