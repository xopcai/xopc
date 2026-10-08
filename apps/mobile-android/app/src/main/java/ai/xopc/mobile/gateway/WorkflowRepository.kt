package ai.xopc.mobile.gateway

import org.json.JSONObject

data class WorkflowRun(val id: String, val title: String, val status: String,
  val goal: String = "", val result: String = "")
data class WorkflowStep(val id: String, val title: String, val status: String,
  val preview: String = "", val error: String = "")
data class WorkflowDetail(val run: WorkflowRun, val phases: List<WorkflowStep>,
  val agents: List<WorkflowStep>, val canCancel: Boolean)

class WorkflowRepository(private val gateway: GatewaySession) {
  fun list(): List<WorkflowRun> {
    val rows = JSONObject(gateway.request("/api/workflows/runs?limit=50")).getJSONArray("runs")
    return (0 until rows.length()).map { parseRun(rows.getJSONObject(it)) }
  }

  fun detail(id: String): WorkflowDetail {
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_WORKFLOW_ID" }
    val view = JSONObject(gateway.request("/api/workflows/runs/$id")).getJSONObject("view")
    val run = parseRun(view.getJSONObject("run"))
    require(run.id == id) { "INVALID_WORKFLOW" }
    return WorkflowDetail(run, listSteps(view, "phases"), listSteps(view, "agents"),
      view.getJSONObject("controls").optBoolean("canCancel"))
  }

  fun cancel(id: String) {
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_WORKFLOW_ID" }
    gateway.request("/api/workflows/runs/$id/cancel", "POST", "{}")
  }

  private fun parseRun(row: JSONObject): WorkflowRun {
    val id = row.getString("id")
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_WORKFLOW" }
    return WorkflowRun(id, row.optString("title").ifBlank { id }, row.getString("status"),
      row.optString("goal"), row.optJSONObject("result")?.optString("summary") ?: "")
  }

  private fun listSteps(view: JSONObject, key: String): List<WorkflowStep> {
    val rows = view.getJSONArray(key)
    return (0 until rows.length()).map { index ->
      val row = rows.getJSONObject(index)
      val id = row.getString("id")
      WorkflowStep(id, row.optString("title").ifBlank { row.optString("label").ifBlank { id } },
        row.getString("status"), row.optString("resultPreview"), row.optString("error"))
    }
  }
}
