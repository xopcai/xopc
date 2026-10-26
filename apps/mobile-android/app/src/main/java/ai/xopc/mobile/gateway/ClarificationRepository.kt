package ai.xopc.mobile.gateway

import org.json.JSONObject
import org.json.JSONArray
import java.security.MessageDigest

fun clarificationRecordKey(scope: String, key: String): String = "clarify." + MessageDigest.getInstance("SHA-256")
  .digest("$scope.$key".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

data class ClarificationQuestion(val id: String, val header: String, val question: String, val type: String,
  val choices: List<ClarificationChoice>, val recommendedChoiceId: String?)
data class ClarificationAnswer(val questionId: String, val choiceId: String? = null, val text: String? = null) {
  fun json(): JSONObject = JSONObject().put("questionId", questionId).apply {
    choiceId?.let { put("choiceId", it) }; text?.trim()?.takeIf(String::isNotEmpty)?.let { put("text", it) }
  }
}


data class ClarificationChoice(val id: String, val label: String, val description: String?)
data class ClarificationRequest(val id: String, val conversationId: String, val question: String,
  val kind: String, val version: Int, val interactionMode: String,
  val choiceDetails: List<ClarificationChoice>, val recommendedChoiceId: String?,
  val approval: JSONObject?, val expiresAt: Long?, val clockOffset: Long = 0,
  val schemaVersion: Int = 1, val questions: List<ClarificationQuestion> = emptyList(), val scope: String = "") {
  fun accepts(answers: List<ClarificationAnswer>): Boolean {
    if (questions.isEmpty() || answers.size != questions.size || answers.map { it.questionId }.distinct().size != answers.size) return false
    if (!questions.all { question ->
      val answer = answers.find { it.questionId == question.id }
      answer != null && (answer.choiceId != null || !answer.text.isNullOrBlank()) && (answer.text?.trim()?.length ?: 0) <= 2000 &&
        (answer.choiceId == null || (question.type == "single_choice" && question.choices.any { it.id == answer.choiceId }))
    }) return false
    return questions.joinToString("\n\n") { question ->
      val answer = answers.single { it.questionId == question.id }
      val label = question.choices.find { it.id == answer.choiceId }?.label
      "${question.header}: ${question.question}\n" + listOfNotNull(label, answer.text?.trim()?.takeIf(String::isNotEmpty)).joinToString("\n")
    }.length <= 8000
  }
  fun expired(now: Long = System.currentTimeMillis()) = expiresAt?.let { it <= now + clockOffset } == true
}
data class ClarificationCommand(val action: String = "answer", val choiceId: String? = null,
  val text: String? = null, val decision: String? = null,
  val schemaVersion: Int? = null, val answers: List<ClarificationAnswer>? = null) {
  fun body(version: Int, idempotencyKey: String): JSONObject {
    require(action in setOf("answer", "agent_decide", "cancel")) { "INVALID_CLARIFICATION_ACTION" }
    val result = JSONObject().put("action", action).put("expectedVersion", version).put("idempotencyKey", idempotencyKey)
    if (schemaVersion == 2) {
      result.put("schemaVersion", 2)
      if (action == "answer") {
        require(answers != null && answers.size in 1..3)
        require(answers.map { it.questionId }.distinct().size == answers.size)
        require(answers.all { (it.choiceId != null || !it.text.isNullOrBlank()) && (it.text?.trim()?.length ?: 0) <= 2000 })
        result.put("answers", JSONArray(answers.map { it.json() }))
      }
      return result
    }
    if (action == "answer") {
      if (decision != null) { require(decision in setOf("approve", "deny")); result.put("decision", decision) }
      else {
        val trimmed = text?.trim().orEmpty()
        require(choiceId != null || trimmed.isNotEmpty()) { "ANSWER_REQUIRED" }
        require(trimmed.length <= 8000) { "ANSWER_TOO_LONG" }
        val response = JSONObject()
        choiceId?.let { response.put("choiceId", it) }
        if (trimmed.isNotEmpty()) response.put("text", trimmed)
        result.put("response", response)
      }
    }
    return result
  }
}

class ClarificationRepository(private val session: GatewaySession) {
  fun snapshot(conversationId: String): ClarificationRequest? {
    require(conversationId.matches(Regex("[0-9a-fA-F-]{36}")))
    val payload = JSONObject(session.request("/api/sessions/$conversationId/clarification")).getJSONObject("payload")
    val row = payload.optJSONObject("clarification") ?: return null
    if (row.getString("status") != "open") return null
    return parse(row, conversationId, payload.optLong("serverTime", System.currentTimeMillis()) - System.currentTimeMillis())
      .copy(scope = session.currentProfile()?.let { "${it.gatewayId}.${it.deviceId}" }.orEmpty())
  }
  fun respond(request: ClarificationRequest, command: ClarificationCommand, idempotencyKey: String) {
    require(!request.expired()) { "CLARIFICATION_EXPIRED" }
    require(request.kind != "approval" || command.action != "agent_decide")
    require(request.schemaVersion != 2 || command.schemaVersion == 2)
    if (request.schemaVersion == 2 && command.action == "answer") {
      require(request.accepts(command.answers ?: emptyList())) { "INVALID_CLARIFICATION_ANSWERS" }
    }
    val key = "clarify-attempt.${request.id}.${request.version}"
    val candidate = command.body(request.version, idempotencyKey).toString()
    val body = if (request.schemaVersion == 2) session.clarificationRecord(key) ?: candidate.also { session.writeClarificationRecord(key, it) } else candidate
    session.request("/api/clarifications/${request.id}/responses", "POST", body)
    session.writeClarificationRecord(key, null)
    if (request.schemaVersion == 2) session.writeClarificationRecord("clarify-draft.${request.id}.${request.version}", null)
  }
  companion object {
    fun parse(row: JSONObject, conversationId: String, clockOffset: Long = 0): ClarificationRequest {
      require(!row.has("choices") && !row.has("suggestedAnswer")) { "UNSUPPORTED_CLARIFICATION" }
      val id = if (row.has("requestId")) row.getString("requestId") else row.getString("id")
      val choices = row.optJSONArray("choiceDetails")
      val details = (0 until (choices?.length() ?: 0)).map { index ->
        val choice = choices!!.getJSONObject(index)
        ClarificationChoice(choice.getString("id"), choice.getString("label"), choice.optString("description").takeIf(String::isNotBlank))
      }
      require(id.matches(Regex("[A-Za-z0-9_-]{1,160}")) && details.size <= 10 && details.map { it.id }.distinct().size == details.size)
      val kind = row.getString("kind"); require(kind in setOf("input", "approval"))
      val approval = row.optJSONObject("approval"); require(kind != "approval" || approval != null)
      val schemaVersion = row.optInt("schemaVersion", 1)
      require(schemaVersion in 1..2 && (schemaVersion != 2 || kind == "input"))
      val questionsJson = row.optJSONArray("questions")
      val questions = (0 until (questionsJson?.length() ?: 0)).map { index ->
        val q = questionsJson!!.getJSONObject(index)
        val options = q.optJSONArray("choices")
        ClarificationQuestion(q.getString("id"), q.getString("header"), q.getString("question"), q.getString("type"),
          (0 until (options?.length() ?: 0)).map { n -> val c = options!!.getJSONObject(n)
            ClarificationChoice(c.getString("id"), c.getString("label"), c.optString("description").takeIf(String::isNotBlank)) },
          q.optString("recommendedChoiceId").takeIf(String::isNotBlank))
      }
      if (schemaVersion == 2) {
        require(questions.size in 1..3 && questions.map { it.id }.distinct().size == questions.size)
        require(questions.all { it.type in setOf("text", "single_choice") && (it.type != "single_choice" || it.choices.size in 2..10) })
      }
      return ClarificationRequest(id, conversationId, row.getString("question"), kind, row.getInt("version"),
        row.optString("interactionMode", "quick"), details, row.optString("recommendedChoiceId").takeIf(String::isNotBlank),
        approval, if (row.has("expiresAt") && !row.isNull("expiresAt")) row.getLong("expiresAt") else null, clockOffset, schemaVersion, questions)
    }
  }
}
