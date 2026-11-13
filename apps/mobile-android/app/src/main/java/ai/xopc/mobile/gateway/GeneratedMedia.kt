package ai.xopc.mobile.gateway

import java.io.File
import java.net.URLEncoder

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import org.json.JSONObject

internal enum class GeneratedMediaKind(val path: String, val extension: String) {
  Music("music", ".mp3"),
  Video("video", ".mp4"),
}

internal data class GeneratedMediaItem(
  val id: String,
  val kind: GeneratedMediaKind,
  val order: Long,
  val title: String?,
  val prompt: String?,
  val lyrics: String?,
  val state: String?,
  val error: String?,
  val duration: Int?,
  val resolution: String?,
  val ratio: String?,
  val version: Int?,
  val draftRevision: Int?,
  val canConfirm: Boolean,
  val costFen: Int?,
  val creditMicro: Long?,
) {
  val isDraft get() = draftRevision != null
  val active get() = state in listOf("queued", "submitted", "submitting", "running", "saving")
}

class GeneratedMediaAccess internal constructor(private val gateway: GatewaySession) {
  internal suspend fun list(conversationId: String, kind: GeneratedMediaKind): List<GeneratedMediaItem> =
    runInterruptible(Dispatchers.IO) {
      parseGeneratedMedia(JSONObject(gateway.request(path(kind, conversationId))), kind)
    }

  internal suspend fun confirm(conversationId: String, item: GeneratedMediaItem): GeneratedMediaItem =
    runInterruptible(Dispatchers.IO) {
      val body = JSONObject().put("id", item.id).put("revision", requireNotNull(item.draftRevision))
      val response = gateway.request(path(item.kind, conversationId) + "/confirm-draft", "POST", body.toString())
      parseItem(JSONObject(response), item.kind)
    }

  internal suspend fun download(conversationId: String, item: GeneratedMediaItem, destination: File) {
    runInterruptible(Dispatchers.IO) {
      val artifact = if (item.kind == GeneratedMediaKind.Music) "audio" else "video"
      gateway.downloadGeneratedMedia(path(item.kind, conversationId) + "/" + encode(item.id) + "/" + artifact, destination)
    }
  }

  private fun path(kind: GeneratedMediaKind, id: String) =
    "/api/${kind.path}-generation/sessions/${encode(id)}/jobs"

  private fun encode(segment: String) = URLEncoder.encode(segment, Charsets.UTF_8.name()).replace("+", "%20")
}

internal fun parseGeneratedMedia(response: JSONObject, kind: GeneratedMediaKind): List<GeneratedMediaItem> {
  val jobs = response.getJSONArray("jobs")
  val transcript = response.string("transcriptId")
  val result = (0 until jobs.length()).mapNotNull { index ->
    val job = jobs.optJSONObject(index) ?: return@mapNotNull null
    if (kind == GeneratedMediaKind.Video && (transcript == null || job.string("transcriptId") != transcript)) {
      return@mapNotNull null
    }
    parseItem(job, kind)
  }
  val draft = response.optJSONObject("draft") ?: return result
  if (kind != GeneratedMediaKind.Video || result.any { it.id == draft.string("id") }) return result
  val model = response.string("modelRef")
  return result + parseItem(draft, kind, response.optBoolean("configured") && model != null && draft.string("modelRef") == model)
}

private fun parseItem(item: JSONObject, kind: GeneratedMediaKind, canConfirm: Boolean = false) = GeneratedMediaItem(
  id = item.getString("id"), kind = kind, order = item.optLong("draftCreatedAt", item.optLong("createdAt")),
  title = item.string("title") ?: item.string("summary"), prompt = item.string("prompt"), lyrics = item.string("lyrics"),
  state = item.string("state"), error = item.string("error"),
  duration = if (kind == GeneratedMediaKind.Music) item.int("durationMs")?.div(1000) else item.int("duration"),
  resolution = item.string("resolution"), ratio = item.string("ratio"), version = item.int("versionNumber"),
  draftRevision = item.int("revision"), canConfirm = canConfirm, costFen = item.int("estimatedCostFen"),
  creditMicro = item.optLong("estimatedCreditMicro", -1).takeIf { it >= 0 },
)

private fun JSONObject.string(key: String) = (opt(key) as? String)?.takeIf(String::isNotBlank)
private fun JSONObject.int(key: String) = (opt(key) as? Number)?.toInt()

internal fun generatedMediaByReply(items: List<GeneratedMediaItem>, rows: List<ConversationMessage>): Map<String, List<GeneratedMediaItem>> {
  val replies = rows.filter { it.role == "assistant" }
  val anchors = buildMap {
    replies.forEach { reply -> reply.generatedMediaIds.forEach { id -> putIfAbsent(id, reply.renderId) } }
  }
  return items.groupBy { anchors[it.id] ?: replies.lastOrNull()?.renderId.orEmpty() }
}
