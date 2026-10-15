package ai.xopc.mobile.gateway

import org.json.JSONObject

data class ClarificationChoice(val id: String, val label: String, val description: String?)
data class ClarificationRequest(val id: String, val conversationId: String, val question: String,
  val kind: String, val version: Int, val interactionMode: String,
  val choiceDetails: List<ClarificationChoice>, val recommendedChoiceId: String?,
  val approval: JSONObject?, val expiresAt: Long?, val clockOffset: Long = 0) {
  fun expired(now: Long = System.currentTimeMillis()) = expiresAt?.let { it <= now + clockOffset } == true
}
data class ClarificationCommand(val action: String = "answer", val choiceId: String? = null,
  val text: String? = null, val decision: String? = null) {
  fun body(version: Int, idempotencyKey: String): JSONObject {
    require(action in setOf("answer", "agent_decide", "cancel")) { "INVALID_CLARIFICATION_ACTION" }
    val result = JSONObject().put("action", action).put("expectedVersion", version).put("idempotencyKey", idempotencyKey)
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
  }
  fun respond(request: ClarificationRequest, command: ClarificationCommand, idempotencyKey: String) {
    require(!request.expired()) { "CLARIFICATION_EXPIRED" }
    require(request.kind != "approval" || command.action != "agent_decide")
    session.request("/api/clarifications/${request.id}/responses", "POST", command.body(request.version, idempotencyKey).toString())
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
      return ClarificationRequest(id, conversationId, row.getString("question"), kind, row.getInt("version"),
        row.optString("interactionMode", "quick"), details, row.optString("recommendedChoiceId").takeIf(String::isNotBlank),
        approval, if (row.has("expiresAt") && !row.isNull("expiresAt")) row.getLong("expiresAt") else null, clockOffset)
    }
  }
}
