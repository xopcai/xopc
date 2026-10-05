package ai.xopc.mobile.gateway

import org.json.JSONObject

data class AutomationSummary(val id: String, val name: String, val description: String,
  val enabled: Boolean, val triggerKind: String, val schedule: String, val instruction: String,
  val projectId: String?, val nextRunAtMs: Long?, val lastRunAtMs: Long?,
  val lastRunStatus: String?, val lastError: String?, val updatedAtMs: Long = 0,
  val canRun: Boolean = true, val canToggle: Boolean = true,
  val canEditDetails: Boolean = false, val canEditSchedule: Boolean = false,
  val canDelete: Boolean = false, val triggerJson: String = "", val actionJson: String = "")
data class AutomationRunSummary(val id: String, val automationId: String, val automationName: String,
  val status: String, val summary: String?, val error: String?, val conversationId: String?,
  val workflowRunId: String?, val createdAtMs: Long?, val startedAtMs: Long?,
  val durationMs: Long?)
data class AutomationRunEvent(val id: String, val message: String, val createdAtMs: Long?)
data class AutomationCancellation(val accepted: Boolean, val confirmed: Boolean)
data class AutomationMetricsNext(val automationId: String, val name: String, val runAtMs: Long)
data class AutomationMetrics(val totalAutomations: Int, val enabledAutomations: Int,
  val runningRuns: Int, val failedLastHour: Int, val nextRun: AutomationMetricsNext?)

/** Authenticated Automation reads shared by Progress and its detail destinations. */
class AutomationRepository(private val gateway: GatewaySession) {
  fun list(): List<AutomationSummary> = parseList(gateway.request("/api/automations"))

  fun metrics(): AutomationMetrics = parseMetrics(gateway.request("/api/automations/metrics"))

  fun detail(id: String): AutomationSummary {
    requireValidId(id)
    return parseDetail(id, gateway.request("/api/automations/$id"))
  }

  fun runs(automationId: String): List<AutomationRunSummary> {
    requireValidId(automationId)
    return parseRuns(automationId,
      gateway.request("/api/automation-runs?limit=30&automationId=$automationId"))
  }

  fun run(id: String): AutomationRunSummary {
    requireValidId(id)
    return parseRunDetail(id, gateway.request("/api/automation-runs/$id"))
  }

  fun events(runId: String): List<AutomationRunEvent> {
    requireValidId(runId)
    return parseEvents(gateway.request("/api/automation-runs/$runId/events"))
  }

  fun runNow(item: AutomationSummary): AutomationRunSummary {
    requireValidId(item.id)
    require(item.canRun) { "AUTOMATION_NOT_RUNNABLE" }
    val run = parseRunDetailForAutomation(item.id,
      gateway.request("/api/automations/${item.id}/run", "POST", "{}"))
    return run
  }

  fun create(name: String, instruction: String, cron: String, key: String): AutomationSummary {
    val title = name.trim()
    val command = instruction.trim()
    val expression = cron.trim()
    require(title.isNotEmpty() && title.length <= 200 && command.isNotEmpty() &&
      command.length <= 50000 && expression.isNotEmpty() && expression.length <= 256) {
      "INVALID_AUTOMATION_FORM"
    }
    requireValidKey(key)
    val body = JSONObject().put("name", title).put("enabled", true)
      .put("trigger", JSONObject().put("kind", "schedule")
        .put("schedule", JSONObject().put("kind", "cron").put("expr", expression)))
      .put("action", JSONObject().put("kind", "agent").put("instruction", command))
      .put("conversationMode", "new_session").toString()
    val created = parseAutomation(JSONObject(gateway.request("/api/automations", "POST", body,
      mapOf("Idempotency-Key" to key))).getJSONObject("automation"))
    require(created.name == title && created.triggerKind == "schedule" &&
      created.schedule == expression && created.instruction == command && created.updatedAtMs > 0) {
      "AUTOMATION_CREATE_NOT_CONFIRMED"
    }
    return created
  }

  fun update(item: AutomationSummary, name: String, instruction: String, cron: String,
    key: String): AutomationSummary {
    requireValidId(item.id)
    require(item.updatedAtMs > 0 && item.canEditSchedule) { "AUTOMATION_NOT_MOBILE_EDITABLE" }
    requireValidKey(key)
    val title = name.trim()
    val command = instruction.trim()
    val expression = cron.trim()
    require(title.isNotEmpty() && title.length <= 200 && command.isNotEmpty() &&
      command.length <= 50000 && expression.isNotEmpty() && expression.length <= 256) {
      "INVALID_AUTOMATION_FORM"
    }
    require(item.canEditDetails || (title == item.name && command == item.instruction)) {
      "AUTOMATION_MANAGED_FIELDS"
    }
    val trigger = JSONObject(item.triggerJson)
    val action = JSONObject(item.actionJson)
    require(trigger.getString("kind") == "schedule" &&
      trigger.getJSONObject("schedule").getString("kind") == "cron" &&
      action.getString("kind") == "agent") { "AUTOMATION_NOT_MOBILE_EDITABLE" }
    trigger.getJSONObject("schedule").put("expr", expression)
    val body = JSONObject().put("expectedRevision", item.updatedAtMs).put("trigger", trigger)
    if (item.canEditDetails) {
      action.put("instruction", command)
      body.put("name", title).put("action", action)
    }
    val updated = parseDetail(item.id, gateway.request("/api/automations/${item.id}", "PATCH",
      body.toString(), mapOf("Idempotency-Key" to key)))
    require(updated.updatedAtMs > item.updatedAtMs && updated.name == title &&
      updated.instruction == command && updated.schedule == expression) {
      "AUTOMATION_CHANGE_NOT_CONFIRMED"
    }
    return updated
  }

  fun delete(item: AutomationSummary, key: String) {
    requireValidId(item.id)
    require(item.canDelete && item.updatedAtMs > 0) { "AUTOMATION_NOT_DELETABLE" }
    requireValidKey(key)
    val body = JSONObject().put("expectedRevision", item.updatedAtMs).toString()
    val removed = JSONObject(gateway.request("/api/automations/${item.id}", "DELETE", body,
      mapOf("Idempotency-Key" to key))).getBoolean("removed")
    require(removed) { "AUTOMATION_DELETE_NOT_CONFIRMED" }
  }

  fun setEnabled(item: AutomationSummary, enabled: Boolean): AutomationSummary {
    requireValidId(item.id)
    require(item.canToggle && item.updatedAtMs > 0 && item.enabled != enabled) {
      "AUTOMATION_NOT_TOGGLEABLE"
    }
    val action = if (enabled) "resume" else "pause"
    val body = JSONObject().put("expectedRevision", item.updatedAtMs).toString()
    val updated = parseDetail(item.id,
      gateway.request("/api/automations/${item.id}/$action", "POST", body))
    require(updated.enabled == enabled && updated.updatedAtMs > item.updatedAtMs) {
      "AUTOMATION_CHANGE_NOT_CONFIRMED"
    }
    return updated
  }

  fun cancelRun(run: AutomationRunSummary): AutomationCancellation {
    requireValidId(run.id)
    require(run.status in setOf("queued", "running", "cancelling")) { "AUTOMATION_RUN_NOT_ACTIVE" }
    val result = JSONObject(gateway.request("/api/automation-runs/${run.id}/cancel", "POST", "{}"))
    val accepted = result.getBoolean("cancelled")
    val confirmed = result.getBoolean("confirmed")
    require(accepted) { "AUTOMATION_CANCEL_NOT_ACCEPTED" }
    return AutomationCancellation(accepted, confirmed)
  }

  fun rerun(run: AutomationRunSummary): AutomationRunSummary {
    requireValidId(run.id)
    require(run.status in setOf("failed", "timeout", "cancelled")) { "AUTOMATION_RUN_NOT_RETRYABLE" }
    val next = parseRunDetailForAutomation(run.automationId,
      gateway.request("/api/automation-runs/${run.id}/rerun", "POST", "{}"))
    require(next.id != run.id) { "AUTOMATION_RERUN_NOT_CONFIRMED" }
    return next
  }

  companion object {
    private val idPattern = Regex("[A-Za-z0-9_-]{1,128}")
    private fun requireValidId(id: String) = require(id.matches(idPattern)) { "INVALID_AUTOMATION_ID" }
    private fun requireValidKey(key: String) = require(key.matches(Regex("[0-9a-fA-F-]{36}"))) {
      "INVALID_IDEMPOTENCY_KEY"
    }

    fun parseList(raw: String): List<AutomationSummary> {
      val rows = JSONObject(raw).getJSONArray("automations")
      require(rows.length() <= 500) { "INVALID_AUTOMATIONS" }
      return (0 until rows.length()).map { parseAutomation(rows.getJSONObject(it)) }
    }

    fun parseMetrics(raw: String): AutomationMetrics {
      val value = JSONObject(raw)
      val next = value.optJSONObject("nextRun")?.let { row ->
        val automationId = row.getString("automationId")
        requireValidId(automationId)
        val name = row.getString("name")
        val runAtMs = row.getLong("runAtMs")
        require(name.isNotBlank() && runAtMs >= 0) { "INVALID_AUTOMATION_METRICS" }
        AutomationMetricsNext(automationId, name.take(200), runAtMs)
      }
      val total = value.getInt("totalAutomations")
      val enabled = value.getInt("enabledAutomations")
      val running = value.getInt("runningRuns")
      val failed = value.getInt("failedLastHour")
      require(total >= 0 && enabled in 0..total && running >= 0 && failed >= 0) {
        "INVALID_AUTOMATION_METRICS"
      }
      return AutomationMetrics(total, enabled, running, failed, next)
    }

    fun parseDetail(id: String, raw: String): AutomationSummary {
      val item = parseAutomation(JSONObject(raw).getJSONObject("automation"))
      require(item.id == id) { "MISMATCHED_AUTOMATION" }
      return item
    }

    fun parseRuns(automationId: String, raw: String): List<AutomationRunSummary> {
      val rows = JSONObject(raw).getJSONArray("runs")
      require(rows.length() <= 100) { "INVALID_AUTOMATION_RUNS" }
      return (0 until rows.length()).map { parseRun(rows.getJSONObject(it)).also { run ->
        require(run.automationId == automationId) { "MISMATCHED_AUTOMATION_RUN" }
      } }
    }

    fun parseRunDetail(id: String, raw: String): AutomationRunSummary {
      val run = parseRun(JSONObject(raw).getJSONObject("run"))
      require(run.id == id) { "MISMATCHED_AUTOMATION_RUN" }
      return run
    }

    fun parseRunDetailForAutomation(automationId: String, raw: String): AutomationRunSummary {
      val run = parseRun(JSONObject(raw).getJSONObject("run"))
      require(run.automationId == automationId) { "MISMATCHED_AUTOMATION_RUN" }
      return run
    }

    fun parseEvents(raw: String): List<AutomationRunEvent> {
      val rows = JSONObject(raw).getJSONArray("events")
      require(rows.length() <= 500) { "INVALID_AUTOMATION_EVENTS" }
      return (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        val id = row.getString("id")
        val message = row.getString("message")
        require(id.isNotBlank() && message.isNotBlank()) { "INVALID_AUTOMATION_EVENT" }
        AutomationRunEvent(id, message.take(4000), row.optLongOrNull("createdAtMs"))
      }
    }

    private fun parseAutomation(row: JSONObject): AutomationSummary {
      val id = row.getString("id")
      requireValidId(id)
      val name = row.getString("name")
      require(name.isNotBlank()) { "INVALID_AUTOMATION" }
      val trigger = row.getJSONObject("trigger")
      val action = row.getJSONObject("action")
      val state = row.optJSONObject("state")
      val management = row.optJSONObject("management")
      val editable = management?.optJSONArray("editable")
      val canToggle = editable == null || (0 until editable.length()).any {
        editable.optString(it) == "enabled"
      }
      val mobileEditable = trigger.optString("kind") == "schedule" &&
        trigger.optJSONObject("schedule")?.optString("kind") == "cron" &&
        action.optString("kind") == "agent"
      val canEditDetails = mobileEditable && management == null
      val canEditSchedule = mobileEditable && (management == null ||
        (0 until (editable?.length() ?: 0)).any { editable?.optString(it) == "trigger" })
      return AutomationSummary(id, name.take(200), row.optString("description").take(2000),
        row.getBoolean("enabled"), trigger.getString("kind"),
        trigger.optJSONObject("schedule")?.optString("expr").orEmpty().take(256),
        action.optString("instruction").take(50000),
        row.optString("projectId").takeIf(String::isNotBlank),
        state?.optLongOrNull("nextRunAtMs"), state?.optLongOrNull("lastRunAtMs"),
        state?.optString("lastRunStatus")?.takeIf(String::isNotBlank),
        state?.optString("lastError")?.takeIf(String::isNotBlank)?.take(4000),
        row.optLongOrNull("updatedAtMs") ?: 0,
        management?.optBoolean("runnable", true) ?: true, canToggle,
        canEditDetails, canEditSchedule, management?.optBoolean("deletable", false) ?: true,
        trigger.toString(), action.toString())
    }

    private fun parseRun(row: JSONObject): AutomationRunSummary {
      val id = row.getString("id")
      val automationId = row.getString("automationId")
      requireValidId(id); requireValidId(automationId)
      val status = row.getString("status")
      require(status.isNotBlank()) { "INVALID_AUTOMATION_RUN" }
      return AutomationRunSummary(id, automationId, row.optString("automationName").take(160), status,
        row.optString("summary").takeIf(String::isNotBlank)?.take(8000),
        row.optString("error").takeIf(String::isNotBlank)?.take(4000),
        row.optString("conversationId").takeIf(String::isNotBlank),
        row.optString("workflowRunId").takeIf(String::isNotBlank),
        row.optLongOrNull("createdAtMs"), row.optLongOrNull("startedAtMs"),
        row.optLongOrNull("durationMs"))
    }

    private fun JSONObject.optLongOrNull(key: String): Long? =
      if (has(key) && !isNull(key)) getLong(key) else null
  }
}
