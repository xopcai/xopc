package ai.xopc.mobile.gateway

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

internal data class PersonalWork(
  val id: String, val title: String, val phase: String, val status: String,
  val operationalState: String, val needsAttention: Boolean, val updatedAt: Long,
) {
  val ended: Boolean get() = phase == "closed" || operationalState in setOf("failed", "cancelled")
}
internal data class PersonalWorkPage(val current: List<PersonalWork>, val history: List<PersonalWork>, val total: Int)
internal data class PersonalDelivery(
  val id: String, val title: String, val taskTitle: String?, val conversationId: String?,
  val target: ConversationTarget?, val media: ConversationMedia?, val musicJob: String?,
)
internal data class PersonalDeliveryPage(val items: List<PersonalDelivery>, val nextOffset: Int?)

class PersonalOverviewAccess internal constructor(private val gateway: GatewaySession, private val automations: AutomationRepository) {
  internal fun work(offset: Int): PersonalWorkPage {
    val data = payload("/api/personal-agent/activity?view=work&limit=10&offset=$offset")
    return PersonalWorkPage(tasks(data.getJSONArray("current")), tasks(data.getJSONArray("items")), data.getInt("total"))
  }

  internal fun deliveries(offset: Int, personalConversationId: String): PersonalDeliveryPage {
    val data = payload("/api/personal-agent/activity?view=deliverables&limit=15&offset=$offset")
    val nextOffset = data.optInt("nextOffset", -1).takeIf { it > offset }
    val items = data.getJSONArray("items").objects().map { row ->
      val task = row.optJSONObject("task")
      val ref = row.optJSONObject("reference")
      val artifact = row.optJSONObject("artifact")
      val title = artifact?.text("title") ?: ref?.text("title") ?: task?.text("title") ?: row.getString("id")
      val conversationId = task?.text("conversationId")
      val target = ref?.let {
        val kind = it.text("kind")
        val id = it.text("id")
        if (kind in setOf("note", "task", "automation", "project", "session") && id != null)
          ConversationTarget(kind!!, id, title) else null
      }
      val uri = artifact?.text("uri")
      val path = artifact?.text("workspaceRelativePath")
      val artifactId = artifact?.text("artifactId")
      val mime = artifact?.text("mimeType").orEmpty()
      val available = artifact?.text("availability") == "available"
      val source = conversationId ?: personalConversationId
      val musicId = artifactId?.takeIf { available &&
        uri == "/api/music-generation/sessions/${URLEncoder.encode(source, "UTF-8")}/jobs/${URLEncoder.encode(it, "UTF-8")}/audio" }
      val media = if (available && (path != null || uri?.let {
          it.startsWith("xopc-file:") || it.startsWith("xopc-file-version:") || it.startsWith("media://")
        } == true)) ConversationMedia(artifactId ?: row.getString("id"), title,
        when {
          mime.startsWith("image/") -> "image"
          mime.startsWith("audio/") -> "audio"
          mime.startsWith("video/") -> "video"
          else -> "file"
        }, mime, artifact.optLong("sizeBytes"), uri.orEmpty(), path) else null
      PersonalDelivery(row.getString("id"), title, task?.text("title"), conversationId, target, media, musicId)
    }
    return PersonalDeliveryPage(items, nextOffset)
  }

  internal fun schedules(): List<AutomationSummary> = automations.personalSchedules()

  private fun payload(path: String): JSONObject = JSONObject(gateway.request(path)).getJSONObject("payload")

  private fun tasks(rows: JSONArray) = rows.objects().map { row ->
    val status = row.optJSONObject("presentation")?.optString("status").orEmpty()
    PersonalWork(row.getString("id"), row.getString("title"), row.optString("phase"), status,
      row.optString("operationalState"), row.optJSONObject("attention") != null || status in setOf("needsUser", "review"),
      row.optLong("updatedAt"))
  }

  private fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key).takeIf(String::isNotBlank)
  private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)
}
