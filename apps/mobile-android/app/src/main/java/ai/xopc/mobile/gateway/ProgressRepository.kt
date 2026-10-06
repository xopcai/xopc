package ai.xopc.mobile.gateway

import org.json.JSONObject
import java.net.URLEncoder

data class ProgressAction(val label: String, val href: String)
data class ProgressHomeAction(val type: String, val label: String, val approvalId: String? = null,
  val decision: String? = null, val subjectKind: String? = null, val runId: String? = null)
data class ProgressItem(val id: String, val title: String, val summary: String,
  val statusLabel: String?, val recommendation: String?, val openAction: ProgressAction?,
  val reviewDetail: String? = null, val primaryAction: ProgressHomeAction? = null,
  val secondaryActions: List<ProgressHomeAction> = emptyList())
data class ProgressHome(val needsUser: List<ProgressItem>, val background: List<ProgressItem>)
data class ProgressTask(val id: String, val title: String, val body: String, val phase: String,
  val resolution: String?, val updatedAt: Long, val closedAt: Long?, val projectId: String?,
  val priority: String? = null, val version: Int = 0,
  val allowedCommands: List<String> = emptyList())
data class ProgressTaskPage(val items: List<ProgressTask>, val total: Int)
data class ProgressProject(val id: String, val name: String, val description: String, val status: String,
  val brief: String, val defaultAgentId: String? = null, val workspaceRoot: String? = null,
  val executionMode: String = "local_checkout")
data class ProgressProjectSession(val id: String, val title: String, val messageCount: Int,
  val isLocalDraft: Boolean = false)

/** Read-only Progress data from the same authenticated Gateway session as Assistant. */
class ProgressRepository(private val gateway: GatewaySession) {
  fun home(language: String): ProgressHome = parseHome(gateway.request("/api/home?locale=$language"))

  fun act(action: ProgressHomeAction) {
    val body = JSONObject()
    val path = when (action.type) {
      "connector_decision" -> {
        require(action.approvalId?.matches(Regex("[A-Za-z0-9_-]{1,200}")) == true &&
          action.decision in setOf("approve", "deny")) { "INVALID_HOME_ACTION" }
        body.put("kind", "connector_approval").put("approvalId", action.approvalId)
          .put("decision", action.decision)
        "/api/home/decisions/respond"
      }
      "retry_run", "acknowledge_run" -> {
        require(action.subjectKind in setOf("automation_run", "workflow_run") &&
          action.runId?.matches(Regex("[A-Za-z0-9_-]{1,200}")) == true) { "INVALID_HOME_ACTION" }
        body.put("kind", action.subjectKind).put("runId", action.runId)
        if (action.type == "retry_run") "/api/home/attention/retry"
        else "/api/home/attention/acknowledge"
      }
      else -> throw IllegalArgumentException("INVALID_HOME_ACTION")
    }
    require(JSONObject(gateway.request(path, "POST", body.toString())).getBoolean("ok")) {
      "HOME_ACTION_NOT_CONFIRMED"
    }
  }

  fun tasks(limit: Int = 50, offset: Int = 0, search: String = ""): ProgressTaskPage {
    require(limit in 1..200 && offset >= 0 && search.length <= 4096) { "INVALID_TASK_PAGE" }
    val query = if (search.isBlank()) "" else "&search=${URLEncoder.encode(search, "UTF-8")}"
    return parseTasks(gateway.request("/api/tasks?limit=$limit&offset=$offset$query"))
  }

  fun task(id: String): ProgressTask {
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_TASK_ID" }
    return parseTaskDetail(id, gateway.request("/api/tasks/$id"))
  }

  fun projects(): List<ProgressProject> = parseProjects(gateway.request(
    "/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc&includeOperating=true"))

  fun project(id: String): ProgressProject {
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_PROJECT_ID" }
    return parseProjectDetail(id, gateway.request("/api/projects/$id"))
  }

  fun projectTasks(id: String): ProgressTaskPage {
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_PROJECT_ID" }
    return parseTasks(gateway.request("/api/tasks?projectId=$id&limit=30&offset=0"))
  }

  fun projectSessions(id: String): List<ProgressProjectSession> {
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_PROJECT_ID" }
    return parseProjectSessions(gateway.request("/api/projects/$id/sessions?limit=100"))
  }

  fun createTask(title: String, body: String, projectId: String, idempotencyKey: String): ProgressTask {
    val cleanTitle = title.trim()
    val cleanProject = projectId.trim()
    require(cleanTitle.isNotEmpty() && cleanTitle.length <= 500 && body.length <= 50_000 &&
      cleanProject.matches(Regex("[A-Za-z0-9_-]{1,128}")) &&
      idempotencyKey.matches(Regex("[A-Za-z0-9_-]{1,200}"))) { "INVALID_TASK_CREATE" }
    val contract = JSONObject().put("objective", body.trim().ifBlank { cleanTitle })
      .put("expectedOutputs", org.json.JSONArray()).put("acceptanceCriteria", org.json.JSONArray())
      .put("constraints", org.json.JSONArray()).put("approvalRequired", org.json.JSONArray())
      .put("assumptions", org.json.JSONArray()).put("risks", org.json.JSONArray())
      .put("acceptancePolicy", "manual").put("outputDestinations", org.json.JSONArray())
    val request = JSONObject().put("idempotencyKey", idempotencyKey).put("title", cleanTitle)
      .put("body", body).put("projectId", cleanProject).put("contract", contract)
      .put("activation", JSONObject().put("mode", "capture").put("phase", "backlog"))
    return parseTaskCreate(gateway.request("/api/tasks", "POST", request.toString()))
  }

  fun command(task: ProgressTask, action: String, idempotencyKey: String, agentId: String = ""): ProgressTask {
    require(task.id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && task.version > 0 &&
      action in task.allowedCommands && action in setOf("mark_ready", "request_review", "close", "reopen", "start")) {
      "INVALID_TASK_COMMAND"
    }
    val selectedAgent = agentId.trim()
    require(action != "start" || selectedAgent.isNotEmpty() && selectedAgent.length <= 128) {
      "INVALID_TASK_AGENT"
    }
    val command = JSONObject().put("type", action)
    if (action == "close") command.put("resolution", "done")
    if (action == "reopen") command.put("phase", "backlog")
    if (action == "start") command.put("executor", JSONObject().put("kind", "agent").put("agentId", selectedAgent))
    val body = JSONObject().put("idempotencyKey", idempotencyKey)
      .put("expectedVersion", task.version).put("command", command)
    return parseTaskDetail(task.id, gateway.request("/api/tasks/${task.id}/commands", "POST", body.toString()),
      minimumVersion = task.version + 1)
  }

  fun updateTask(task: ProgressTask, title: String, body: String, projectId: String): ProgressTask {
    require(task.id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && task.version > 0) { "INVALID_TASK_ID" }
    val cleanTitle = title.trim()
    val cleanProject = projectId.trim()
    require(cleanTitle.isNotEmpty() && cleanTitle.length <= 500 && body.length <= 50_000 &&
      cleanProject.length <= 512) { "INVALID_TASK_EDIT" }
    val patch = JSONObject().put("expectedVersion", task.version).put("title", cleanTitle)
      .put("body", body).put("projectId", if (cleanProject.isBlank()) JSONObject.NULL else cleanProject)
    return parseTaskUpdate(task.id, task.version, gateway.request("/api/tasks/${task.id}", "PATCH", patch.toString()))
  }

  companion object {
    fun parseProjects(raw: String): List<ProgressProject> {
      val root = JSONObject(raw)
      require(root.getBoolean("ok")) { "INVALID_PROGRESS_PROJECTS" }
      val rows = root.getJSONArray("items")
      require(rows.length() <= 100) { "INVALID_PROGRESS_PROJECTS" }
      return (0 until rows.length()).map { parseProject(rows.getJSONObject(it)) }
    }

    fun parseProjectDetail(expectedId: String, raw: String): ProgressProject {
      val root = JSONObject(raw)
      require(root.getBoolean("ok")) { "INVALID_PROGRESS_PROJECT" }
      return parseProject(root.getJSONObject("project")).also {
        require(it.id == expectedId) { "MISMATCHED_PROGRESS_PROJECT" }
      }
    }

    fun parseProjectSessions(raw: String): List<ProgressProjectSession> {
      val root = JSONObject(raw)
      require(root.getBoolean("ok")) { "INVALID_PROJECT_SESSIONS" }
      val rows = root.getJSONArray("sessions")
      require(rows.length() <= 100) { "INVALID_PROJECT_SESSIONS" }
      return (0 until rows.length()).map { rows.getJSONObject(it) }
        .filter { it.optJSONObject("customData")?.optString("origin") != "task" }
        .map { row ->
          val id = row.getString("key")
          val count = row.getInt("messageCount")
          require(id.matches(Regex("[0-9a-fA-F-]{36}")) && count >= 0) { "INVALID_PROJECT_SESSIONS" }
          val title = sequenceOf("displayName", "name", "title")
            .mapNotNull { row.optString(it).takeIf(String::isNotBlank) }.firstOrNull() ?: id
          ProgressProjectSession(id, title.take(160), count)
        }
    }

    fun parseTaskCreate(raw: String): ProgressTask {
      val root = JSONObject(raw)
      require(root.getBoolean("ok")) { "INVALID_PROGRESS_TASK_CREATE" }
      val task = parseTask(root.getJSONObject("task"))
      require(task.version > 0) { "INVALID_PROGRESS_TASK_CREATE" }
      return task
    }

    private fun parseProject(row: JSONObject): ProgressProject {
      val id = row.getString("id")
      val name = row.getString("name")
      require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && name.isNotBlank()) {
        "INVALID_PROGRESS_PROJECT"
      }
      val mode = row.optString("executionMode").ifBlank { "local_checkout" }
      require(mode in setOf("local_checkout", "managed_worktree")) { "INVALID_PROGRESS_PROJECT" }
      return ProgressProject(id, name.take(160), row.optString("description").take(4000),
        row.optString("status"), row.optString("brief").take(4000),
        row.optString("defaultAgentId").takeIf { !row.isNull("defaultAgentId") && it.isNotBlank() },
        row.optString("workspaceRoot").takeIf { !row.isNull("workspaceRoot") && it.isNotBlank() }, mode)
    }

    fun parseHome(raw: String): ProgressHome {
      val root = JSONObject(raw)
      val decisions = root.optJSONArray("decisions")
      fun homeAction(row: JSONObject?): ProgressHomeAction? {
        if (row == null) return null
        val type = row.optString("type")
        val action = ProgressHomeAction(type, row.optString("label").take(80),
          row.optString("approvalId").takeIf(String::isNotBlank),
          row.optString("decision").takeIf(String::isNotBlank),
          row.optString("subjectKind").takeIf(String::isNotBlank),
          row.optString("runId").takeIf(String::isNotBlank))
        return when (type) {
          "connector_decision" -> action.takeIf { it.approvalId?.matches(Regex("[A-Za-z0-9_-]{1,200}")) == true &&
            it.decision in setOf("approve", "deny") && it.label.isNotBlank() }
          "retry_run", "acknowledge_run" -> action.takeIf {
            it.subjectKind in setOf("automation_run", "workflow_run") &&
              it.runId?.matches(Regex("[A-Za-z0-9_-]{1,200}")) == true && it.label.isNotBlank() }
          else -> null
        }
      }
      fun items(key: String): List<ProgressItem> {
        val rows = root.getJSONArray(key)
        require(rows.length() <= 100) { "INVALID_PROGRESS_HOME" }
        return (0 until rows.length()).map { index ->
          val row = rows.getJSONObject(index)
          val id = row.getString("id")
          val title = row.getString("title")
          val summary = row.getString("summary")
          require(id.isNotBlank() && title.isNotBlank()) { "INVALID_PROGRESS_HOME" }
          val action = row.optJSONObject("openAction")?.let { candidate ->
            if (candidate.optString("type") == "open") {
              val href = candidate.getString("href")
              ProgressAction(candidate.getString("label").take(80), href)
            } else null
          }
          val primary = homeAction(row.optJSONObject("primaryAction"))
          val secondaryRows = row.optJSONArray("secondaryActions")
          val secondary = if (secondaryRows == null) emptyList() else (0 until minOf(secondaryRows.length(), 10))
            .mapNotNull { homeAction(secondaryRows.optJSONObject(it)) }
          val approvalId = (listOfNotNull(primary) + secondary).firstOrNull {
            it.type == "connector_decision" }?.approvalId
          val reviewDetail = if (approvalId == null || decisions == null) null else
            (0 until decisions.length()).mapNotNull { decisions.optJSONObject(it) }.firstOrNull {
              it.optJSONObject("response")?.optString("approvalId") == approvalId
            }?.optString("detail")?.takeIf(String::isNotBlank)?.take(4000)
          ProgressItem(id, title.take(160), summary.take(500),
            row.optString("statusLabel").takeIf(String::isNotBlank)?.take(80),
            row.optString("recommendation").takeIf(String::isNotBlank)?.take(500), action,
            reviewDetail, primary, secondary)
        }
      }
      return ProgressHome(items("needsUser"), items("background"))
    }

    fun parseTasks(raw: String): ProgressTaskPage {
      val root = JSONObject(raw)
      require(root.getBoolean("ok")) { "INVALID_PROGRESS_TASKS" }
      val rows = root.getJSONArray("items")
      require(rows.length() <= 200) { "INVALID_PROGRESS_TASKS" }
      val tasks = (0 until rows.length()).map { index ->
        parseTask(rows.getJSONObject(index).getJSONObject("task"))
      }
      val total = root.optInt("total", tasks.size)
      require(total >= tasks.size) { "INVALID_PROGRESS_TASKS" }
      return ProgressTaskPage(tasks, total)
    }

    fun parseTaskDetail(expectedId: String, raw: String, minimumVersion: Int = 1): ProgressTask {
      val root = JSONObject(raw)
      require(root.getBoolean("ok")) { "INVALID_PROGRESS_TASK" }
      val base = parseTask(root.getJSONObject("task"))
      require(base.id == expectedId && base.version >= minimumVersion) { "MISMATCHED_PROGRESS_TASK" }
      val commands = root.getJSONArray("allowedCommands")
      require(commands.length() <= 30) { "INVALID_PROGRESS_TASK" }
      return base.copy(allowedCommands = (0 until commands.length()).map { commands.getString(it) })
    }

    fun parseTaskUpdate(expectedId: String, previousVersion: Int, raw: String): ProgressTask {
      val root = JSONObject(raw)
      require(root.getBoolean("ok")) { "INVALID_PROGRESS_TASK_UPDATE" }
      val task = parseTask(root.getJSONObject("task"))
      require(task.id == expectedId && task.version > previousVersion) { "MISMATCHED_PROGRESS_TASK_UPDATE" }
      return task
    }

    private fun parseTask(task: JSONObject): ProgressTask {
      val id = task.getString("id")
      val title = task.getString("title")
      val phase = task.getString("phase")
      require(id.isNotBlank() && title.isNotBlank() &&
        phase in setOf("backlog", "ready", "active", "review", "closed")) { "INVALID_PROGRESS_TASK" }
      return ProgressTask(id, title.take(160), task.optString("body").take(4000), phase,
        task.optString("resolution").takeIf(String::isNotBlank), task.getLong("updatedAt"),
        if (task.has("closedAt")) task.getLong("closedAt") else null,
        task.optString("projectId").takeIf(String::isNotBlank),
        task.optString("priority").takeIf(String::isNotBlank), task.getInt("version"))
    }
  }
}
