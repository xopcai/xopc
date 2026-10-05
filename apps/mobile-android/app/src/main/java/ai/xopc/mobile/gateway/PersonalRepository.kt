package ai.xopc.mobile.gateway

import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class PersonalCounts(val total: Int, val explicit: Int, val learned: Int,
  val review: Int, val workMemory: Int)
data class PersonalGoal(val id: String, val title: String, val outcome: String,
  val status: String, val targetAt: Long?, val isPrimary: Boolean)
data class PersonalAssertion(val id: String, val statement: String, val authority: String,
  val status: String = "", val scope: String = "", val confidence: Double = 0.0,
  val sources: List<String> = emptyList(), val recordedAt: Long = 0)
data class PersonalRule(val id: String, val statement: String)
data class PersonalProfile(val callName: String, val role: String, val pronouns: String,
  val timezone: String, val locale: String)
data class PersonalSummary(val name: String, val role: String, val counts: PersonalCounts,
  val focusTitle: String, val focusOutcome: String, val goals: List<PersonalGoal>,
  val recent: List<PersonalAssertion>, val rules: List<PersonalRule>,
  val profile: PersonalProfile = PersonalProfile(name, role, "", "", ""))
data class PersonalAssertionPage(val items: List<PersonalAssertion>, val nextCursor: String?)

/** The same bounded mobile projection used by Harmony's Personal page. */
class PersonalRepository(private val gateway: GatewaySession) {
  fun summary(): PersonalSummary = parseSummary(gateway.request("/api/user-model/mobile-summary"))

  fun assertions(filter: String, query: String, cursor: String? = null): PersonalAssertionPage {
    require(filter in setOf("all", "explicit", "learned", "review")) { "INVALID_ASSERTION_FILTER" }
    require(query.length <= 100) { "INVALID_ASSERTION_QUERY" }
    fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
    val path = buildString {
      append("/api/user-model/assertions?view=mobile&limit=20&filter=").append(filter)
      if (query.isNotBlank()) append("&q=").append(encode(query.trim()))
      if (!cursor.isNullOrBlank()) append("&cursor=").append(encode(cursor))
    }
    return parseAssertions(gateway.request(path))
  }

  fun assertion(id: String): PersonalAssertion {
    requireValidAssertionId(id)
    val result = parseAssertion(JSONObject(gateway.request("/api/user-model/assertions/$id"))
      .getJSONObject("assertion"))
    require(result.id == id) { "MISMATCHED_ASSERTION" }
    return result
  }

  fun updateProfile(profile: PersonalProfile): PersonalProfile {
    val clean = profile.copy(callName = profile.callName.trim(), role = profile.role.trim(),
      pronouns = profile.pronouns.trim(), timezone = profile.timezone.trim(),
      locale = profile.locale.trim())
    require(listOf(clean.callName, clean.role, clean.pronouns, clean.timezone, clean.locale)
      .all { it.length <= 200 }) { "INVALID_PROFILE_FORM" }
    require(clean.locale in setOf("", "zh", "en")) { "INVALID_PROFILE_LOCALE" }
    if (clean.timezone.isNotBlank()) java.time.ZoneId.of(clean.timezone)
    val body = JSONObject().put("callName", clean.callName).put("role", clean.role)
      .put("pronouns", clean.pronouns).put("timezone", clean.timezone).put("locale", clean.locale)
    val response = JSONObject(gateway.request("/api/user-model/profile", "PATCH", body.toString()))
      .getJSONObject("profile")
    val saved = PersonalProfile(response.optString("callName"), response.optString("role"),
      response.optString("pronouns"), response.optString("timezone"), response.optString("locale"))
    require(saved == clean) { "PROFILE_SAVE_NOT_CONFIRMED" }
    return saved
  }

  fun updateStatement(id: String, statement: String): PersonalAssertion {
    requireValidAssertionId(id)
    val value = statement.trim()
    require(value.isNotEmpty() && value.length <= 10_000) { "INVALID_ASSERTION_STATEMENT" }
    val response = JSONObject(gateway.request("/api/user-model/assertions/$id", "PATCH",
      JSONObject().put("statement", value).toString()))
    val nextId = response.getJSONObject("assertion").getString("id")
    requireValidAssertionId(nextId)
    return assertion(nextId).also { require(it.statement == value) { "ASSERTION_CHANGE_NOT_CONFIRMED" } }
  }

  fun deleteAssertion(id: String) {
    requireValidAssertionId(id)
    val response = JSONObject(gateway.request("/api/user-model/assertions/$id", "DELETE"))
    require(response.getBoolean("ok")) { "ASSERTION_DELETE_NOT_CONFIRMED" }
  }

  fun saveGoal(id: String?, title: String, outcome: String, status: String,
    targetAt: Long?): String {
    val cleanTitle = title.trim()
    val cleanOutcome = outcome.trim()
    require(cleanTitle.isNotEmpty() && cleanTitle.length <= 120 &&
      cleanOutcome.isNotEmpty() && cleanOutcome.length <= 600) { "INVALID_GOAL_FORM" }
    require(targetAt == null || targetAt > 0) { "INVALID_GOAL_DATE" }
    val editing = !id.isNullOrBlank()
    if (editing) require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")) &&
      status in setOf("active", "paused", "achieved")) { "INVALID_GOAL_PATCH" }
    val body = JSONObject().put("title", cleanTitle).put("desiredOutcome", cleanOutcome)
    if (editing) body.put("status", status).put("targetAt", targetAt ?: JSONObject.NULL)
    else {
      body.put("scope", JSONObject().put("type", "global"))
      if (targetAt != null) body.put("targetAt", targetAt)
    }
    val path = if (editing) "/api/user-model/goals/$id" else "/api/user-model/goals"
    val response = JSONObject(gateway.request(path, if (editing) "PATCH" else "POST", body.toString()))
      .getJSONObject("goal")
    require(response.getString("title") == cleanTitle &&
      response.getString("desiredOutcome") == cleanOutcome &&
      (!editing || response.getString("id") == id)) { "GOAL_SAVE_NOT_CONFIRMED" }
    return response.getString("id")
  }

  companion object {
    private fun requireValidAssertionId(id: String) = require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) {
      "INVALID_ASSERTION_ID"
    }

    fun parseAssertions(raw: String): PersonalAssertionPage {
      val json = JSONObject(raw)
      val rows = json.getJSONArray("items")
      require(rows.length() <= 20) { "INVALID_ASSERTION_PAGE" }
      return PersonalAssertionPage((0 until rows.length()).map { parseAssertion(rows.getJSONObject(it)) },
        json.optString("nextCursor").takeIf { it.isNotBlank() })
    }

    private fun parseAssertion(json: JSONObject): PersonalAssertion {
      val sources = json.optJSONArray("sources")
      require((sources?.length() ?: 0) <= 100) { "INVALID_ASSERTION_SOURCES" }
      return PersonalAssertion(json.getString("id"), json.getString("statement"),
        json.optString("authority"), json.optString("status"),
        json.optJSONObject("scope")?.optString("type").orEmpty(), json.optDouble("confidence", 0.0),
        (0 until (sources?.length() ?: 0)).map { index ->
          sources!!.getJSONObject(index).optString("label").ifBlank { "" }
        }.filter { it.isNotBlank() }, json.optLong("recordedAt"))
    }

    fun parseSummary(raw: String): PersonalSummary {
      val json = JSONObject(raw)
      val profile = json.getJSONObject("profile")
      val counts = json.getJSONObject("counts")
      val focus = json.optJSONObject("primaryFocus")
      val goals = json.optJSONArray("goals")
      val recent = json.getJSONArray("recent")
      val rules = json.getJSONArray("rules")
      require((goals?.length() ?: 0) <= 5 && recent.length() <= 3 && rules.length() <= 3) {
        "INVALID_PERSONAL_SUMMARY"
      }
      val name = profile.optString("callName").trim().ifEmpty { json.optString("suggestedCallName").trim() }
      return PersonalSummary(name, profile.optString("role").trim(),
        PersonalCounts(counts.getInt("total"), counts.getInt("explicit"), counts.getInt("learned"),
          counts.getInt("review"), counts.getInt("workMemory")),
        focus?.optString("title").orEmpty(), focus?.optString("desiredOutcome").orEmpty(),
        (0 until (goals?.length() ?: 0)).map { index ->
          val goal = goals!!.getJSONObject(index)
          PersonalGoal(goal.getString("id"), goal.getString("title"), goal.getString("desiredOutcome"),
            goal.getString("status"), goal.optLong("targetAt").takeIf { goal.has("targetAt") },
            goal.optBoolean("isPrimary"))
        },
        (0 until recent.length()).map { index -> parseAssertion(recent.getJSONObject(index)) },
        (0 until rules.length()).map { index ->
          val rule = rules.getJSONObject(index)
          PersonalRule(rule.getString("id"), rule.getString("statement"))
        }, PersonalProfile(profile.optString("callName"), profile.optString("role"),
          profile.optString("pronouns"), profile.optString("timezone"), profile.optString("locale")))
    }
  }
}
