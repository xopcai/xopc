package ai.xopc.mobile.gateway

import java.net.URLEncoder
import org.json.JSONObject
import org.json.JSONArray

data class NoteSummary(val id: String, val title: String, val snippet: String, val status: String,
  val kind: String, val updatedAt: Long, val pinned: Boolean, val tags: List<String>)
data class NotePage(val items: List<NoteSummary>, val total: Int, val hasMore: Boolean)
data class NoteDetail(val id: String, val title: String, val markdown: String, val status: String,
  val kind: String, val updatedAt: Long, val pinned: Boolean, val tags: List<String>,
  val remoteVersion: Long?, val attachments: List<NoteAttachment> = emptyList())
data class NoteAttachment(val id: String, val type: String, val fileName: String,
  val mimeType: String, val size: Long, val durationSeconds: Int?)
data class NoteSyncResult(val note: NoteDetail, val conflict: Boolean)
data class NoteMetadataPatch(val pinned: Boolean? = null, val status: String? = null,
  val tags: List<String>? = null)
data class NoteHistoryEntry(val timestamp: Long, val trigger: String, val snippet: String)
data class NoteSnapshot(val noteId: String, val timestamp: Long, val trigger: String,
  val title: String?, val markdown: String)
data class NoteShare(val noteId: String, val id: String, val title: String, val url: String,
  val reachability: String, val hint: String, val expiresAt: String)
data class NoteAiPreview(val patchId: String, val summary: String, val message: String,
  val originalMarkdown: String, val proposedMarkdown: String, val title: String?,
  val tags: List<String>?, val status: String?)

/** Bounded, authenticated projection of the Gateway's Notes list and detail. */
class NoteRepository(private val gateway: GatewaySession) {
  fun addMedia(noteId: String, name: String, mimeType: String, bytes: ByteArray,
    mutationId: String, durationSeconds: Int? = null): NoteAttachment {
    requireValidId(noteId)
    val raw = gateway.uploadNoteMedia("/api/notes/$noteId/media", name, mimeType, bytes,
      mutationId, durationSeconds)
    return parseAttachment(JSONObject(raw).getJSONObject("attachment"))
  }

  fun mediaBytes(noteId: String, attachmentId: String): ByteArray {
    requireValidId(noteId); requireValidId(attachmentId)
    return gateway.requestBytes("/api/notes/$noteId/media/$attachmentId")
  }
  fun openConversation(id: String): String {
    requireValidId(id)
    val result = JSONObject(gateway.request("/api/notes/$id/chat", "POST"))
    val binding = result.getJSONObject("sourceBinding")
    require(binding.getString("kind") == "note" && binding.getString("sourceId") == id &&
      binding.getString("version").isNotBlank()) { "INVALID_NOTE_CONVERSATION" }
    return result.getString("conversationId").also { require(it.isNotBlank()) }
  }

  fun previewAiEdit(note: NoteDetail, instruction: String, markdown: String): NoteAiPreview {
    requireValidId(note.id)
    require(instruction.isNotBlank() && instruction.length <= 10_000) { "INVALID_NOTE_INSTRUCTION" }
    val context = JSONObject().put("type", "note").put("range", JSONObject()
      .put("start", 0).put("end", markdown.length))
    val body = JSONObject().put("instruction", instruction.trim()).put("markdown", markdown)
      .put("context", context)
    val result = JSONObject(gateway.request("/api/notes/${note.id}/ai/edit", "POST", body.toString()))
    val patch = result.getJSONObject("patch")
    val operations = patch.getJSONArray("operations")
    require(operations.length() <= 100) { "INVALID_AI_PATCH" }
    var proposed = markdown
    val ranged = mutableListOf<JSONObject>()
    for (index in 0 until operations.length()) {
      val op = operations.getJSONObject(index)
      if (op.getString("type") in setOf("replaceRange", "insertAt")) ranged += op
    }
    ranged.sortedByDescending { if (it.getString("type") == "insertAt") it.getInt("offset")
      else it.getInt("from") }.forEach { op ->
      val start = if (op.getString("type") == "insertAt") op.getInt("offset") else op.getInt("from")
      val end = if (op.getString("type") == "insertAt") start else op.getInt("to")
      require(start in 0..proposed.length && end in start..proposed.length) { "INVALID_AI_PATCH" }
      proposed = proposed.replaceRange(start, end, op.getString("markdown"))
    }
    var title: String? = null
    var tags: List<String>? = null
    var status: String? = null
    for (index in 0 until operations.length()) {
      val op = operations.getJSONObject(index)
      when (op.getString("type")) {
        "appendSection" -> proposed = proposed.trimEnd() + "\n\n" + noteSection(op)
        "prependSection" -> proposed = noteSection(op) + "\n\n" + proposed
        "replaceSection" -> proposed = replaceNoteSection(proposed, op.getString("sectionId"),
          op.getString("markdown"))
        "updateMetadata" -> {
          if (op.has("title")) title = op.getString("title")
          if (op.has("tags")) tags = jsonTags(op.getJSONArray("tags"))
          if (op.has("status")) status = op.getString("status").also {
            require(it in statuses) { "INVALID_AI_PATCH" }
          }
        }
        "replaceRange", "insertAt" -> Unit
        else -> throw IllegalArgumentException("INVALID_AI_PATCH")
      }
    }
    return NoteAiPreview(patch.getString("id"), patch.optString("summary"),
      result.optString("message"), markdown, proposed, title, tags, status)
  }

  private fun noteSection(op: JSONObject): String =
    (op.optString("heading").trim().takeIf(String::isNotEmpty)?.let { "## $it\n\n" } ?: "") +
      op.getString("markdown").trim()

  private fun replaceNoteSection(markdown: String, sectionId: String, replacement: String): String {
    val target = sectionId.trim().lowercase()
    if (target.isEmpty()) return markdown
    val lines = markdown.split('\n').toMutableList()
    val headings = Regex("^#{1,6}\\s+(.+)$")
    val slug = { value: String -> value.trim().lowercase().replace(Regex("[^a-z0-9\\u4e00-\\u9fff]+"), "-")
      .trim('-') }
    val start = lines.indexOfFirst { line -> headings.find(line)?.groupValues?.get(1)?.let(slug) == target }
    if (start < 0) return markdown
    val end = (start + 1 until lines.size).firstOrNull { headings.matches(lines[it]) } ?: lines.size
    lines.subList(start + 1, end).clear()
    lines.addAll(start + 1, replacement.trim().split('\n'))
    return lines.joinToString("\n")
  }

  private fun jsonTags(rows: JSONArray): List<String> = (0 until rows.length()).map(rows::getString).also {
    require(it.size <= 100 && it.all { tag -> tag.isNotBlank() && tag.length <= 512 }) { "INVALID_AI_PATCH" }
  }
  fun list(search: String = "", status: String = "", offset: Int = 0, limit: Int = 30): NotePage {
    require(search.length <= 4096 && status in setOf("", "inbox", "processed", "archived") &&
      offset >= 0 && limit in 1..100) { "INVALID_NOTE_QUERY" }
    val query = URLEncoder.encode(search.trim(), "UTF-8")
    val path = "/api/notes?limit=$limit&offset=$offset&sortBy=updatedAt&sortOrder=desc&search=$query" +
      if (status.isNotEmpty()) "&status=$status" else ""
    return parseList(gateway.request(path), offset)
  }

  fun listProject(projectId: String): NotePage {
    requireValidId(projectId)
    return parseList(gateway.request("/api/notes?projectId=$projectId&limit=30&offset=0" +
      "&sortBy=updatedAt&sortOrder=desc"), 0)
  }

  fun detail(id: String): NoteDetail {
    requireValidId(id)
    return parseDetail(id, gateway.request("/api/notes/$id"))
  }

  fun create(draft: NoteDraft): NoteDetail {
    require(draft.title.isNotBlank() || draft.markdown.isNotBlank()) { "EMPTY_NOTE" }
    val body = JSONObject().put("title", draft.title.trim()).put("markdown", draft.markdown)
      .put("kind", "thought").put("channel", "app").put("platform", "android")
    val result = gateway.request("/api/notes", "POST", body.toString(),
      mapOf("Idempotency-Key" to draft.mutationId))
    val row = JSONObject(result).getJSONObject("note")
    return parseDetail(row.getString("id"), result)
  }

  fun quickCaptureMessage(text: String, mutationId: String): String {
    require(text.isNotBlank() && text.length <= 2_000_000 &&
      text.toByteArray(Charsets.UTF_8).size <= 4_500_000) { "INVALID_NOTE_CAPTURE" }
    require(mutationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_NOTE_MUTATION_ID" }
    val body = JSONObject().put("text", text).put("channel", "app").put("platform", "android")
    val result = gateway.request("/api/notes/quick-capture", "POST", body.toString(),
      mapOf("Idempotency-Key" to mutationId))
    return JSONObject(result).getJSONObject("note").getString("id").also(::requireValidId)
  }

  fun sync(draft: NoteDraft): NoteSyncResult {
    requireValidId(draft.id)
    require(!draft.id.startsWith("local-") && draft.baseRemoteVersion > 0) { "INVALID_NOTE_SYNC" }
    val body = JSONObject().put("noteId", draft.id).put("title", draft.title.trim())
      .put("markdown", draft.markdown).put("localVersion", draft.version)
      .put("baseRemoteVersion", draft.baseRemoteVersion)
    val raw = try { gateway.request("/api/notes/sync", "POST", body.toString()) }
    catch (error: GatewayHttpException) {
      if (error.status == 409) return NoteSyncResult(detail(draft.id), true)
      throw error
    }
    val result = JSONObject(raw)
    require(!result.optBoolean("conflict")) { "INVALID_NOTE_SYNC" }
    val note = parseDetail(draft.id, raw)
    require((note.remoteVersion ?: 0) > draft.baseRemoteVersion) { "STALE_NOTE_SYNC" }
    return NoteSyncResult(note, false)
  }

  fun updateMetadata(note: NoteDetail, patch: NoteMetadataPatch): NoteDetail {
    requireValidId(note.id)
    val revision = requireNotNull(note.remoteVersion) { "MISSING_NOTE_REVISION" }
    require(revision > 0 && listOf(patch.pinned, patch.status, patch.tags).any { it != null }) {
      "INVALID_NOTE_METADATA_PATCH"
    }
    require(patch.status == null || patch.status in statuses) { "INVALID_NOTE_STATUS" }
    require(patch.tags == null || (patch.tags.size <= 100 &&
      patch.tags.all { it.isNotBlank() && it.length <= 512 })) { "INVALID_NOTE_TAGS" }
    val body = JSONObject().put("expectedRevision", revision)
    patch.pinned?.let { body.put("pinned", it) }
    patch.status?.let { body.put("status", it) }
    patch.tags?.let { body.put("tags", org.json.JSONArray(it)) }
    val updated = parseDetail(note.id, gateway.request("/api/notes/${note.id}", "PATCH", body.toString()))
    require((updated.remoteVersion ?: 0) > revision &&
      (patch.pinned == null || updated.pinned == patch.pinned) &&
      (patch.status == null || updated.status == patch.status) &&
      (patch.tags == null || updated.tags == patch.tags)) { "STALE_NOTE_METADATA" }
    return updated
  }

  fun history(id: String): List<NoteHistoryEntry> {
    requireValidId(id)
    return parseHistory(gateway.request("/api/notes/$id/history"))
  }

  fun snapshot(id: String, timestamp: Long): NoteSnapshot {
    requireValidId(id)
    require(timestamp > 0) { "INVALID_NOTE_TIMESTAMP" }
    return parseSnapshot(id, timestamp, gateway.request("/api/notes/$id/history/$timestamp"))
  }

  fun delete(note: NoteDetail, mutationId: String) {
    requireValidId(note.id)
    require(mutationId.matches(Regex("[0-9a-fA-F-]{36}"))) { "INVALID_NOTE_MUTATION_ID" }
    val revision = requireNotNull(note.remoteVersion) { "MISSING_NOTE_REVISION" }
    require(revision > 0) { "INVALID_NOTE_REVISION" }
    val body = JSONObject().put("expectedRevision", revision)
    val raw = gateway.request("/api/notes/${note.id}", "DELETE", body.toString(),
      mapOf("Idempotency-Key" to mutationId))
    require(parseDeleteResponse(raw)) { "UNCONFIRMED_NOTE_DELETE" }
  }

  fun share(note: NoteDetail): NoteShare {
    requireValidId(note.id)
    require(note.updatedAt > 0) { "INVALID_NOTE_VERSION" }
    val body = JSONObject().put("expectedNoteVersion", note.updatedAt).put("ttlMs", 86_400_000)
    return parseShare(gateway.request("/api/notes/${note.id}/shares", "POST", body.toString()), note)
  }

  companion object {
    private val idPattern = Regex("[A-Za-z0-9_-]{1,128}")
    private val statuses = setOf("inbox", "processed", "archived", "trashed")
    private val kinds = setOf("thought", "todo", "voice", "media", "bookmark", "mixed", "task")
    private val triggers = setOf("edit", "ai_edit", "sync", "restore")
    private fun requireValidId(id: String) = require(id.matches(idPattern)) { "INVALID_NOTE_ID" }

    fun parseList(raw: String, offset: Int): NotePage {
      require(offset >= 0) { "INVALID_NOTE_OFFSET" }
      val result = JSONObject(raw)
      val rows = result.getJSONArray("items")
      require(rows.length() <= 30) { "INVALID_NOTE_LIST" }
      val total = result.getInt("total")
      require(total >= 0) { "INVALID_NOTE_LIST" }
      val items = (0 until rows.length()).map { row -> parseSummary(rows.getJSONObject(row)) }
      val hasMore = result.optBoolean("hasMore", offset + items.size < total)
      require(!hasMore || items.isNotEmpty()) { "INVALID_NOTE_PAGE" }
      return NotePage(items, total, hasMore)
    }

    fun parseDetail(id: String, raw: String): NoteDetail {
      requireValidId(id)
      val row = JSONObject(raw).getJSONObject("note")
      val summary = parseSummary(row)
      require(summary.id == id) { "MISMATCHED_NOTE" }
      val markdown = row.getString("markdown")
      require(markdown.length <= 2_000_000) { "INVALID_NOTE" }
      val revision = if (row.has("remoteVersion") && !row.isNull("remoteVersion"))
        row.getLong("remoteVersion").also { require(it > 0) { "INVALID_NOTE_REVISION" } } else null
      val rows = row.optJSONArray("attachments") ?: JSONArray()
      require(rows.length() <= 100) { "INVALID_NOTE_ATTACHMENTS" }
      val attachments = (0 until rows.length()).map { parseAttachment(rows.getJSONObject(it)) }
      return NoteDetail(id, summary.title, markdown, summary.status, summary.kind,
        summary.updatedAt, summary.pinned, summary.tags, revision, attachments)
    }

    private fun parseAttachment(row: JSONObject): NoteAttachment {
      val id = row.getString("id")
      val type = row.getString("type")
      val fileName = row.getString("fileName")
      val mimeType = row.getString("mimeType")
      val size = row.getLong("size")
      val duration = row.optInt("duration").takeIf { row.has("duration") }
      require(id.matches(idPattern) && type in setOf("image", "video", "audio", "file") &&
        fileName.isNotBlank() && fileName.length <= 255 && size in 1..(8L * 1024 * 1024) &&
        mimeType.matches(Regex("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")) &&
        (duration == null || duration in 1..600)) { "INVALID_NOTE_ATTACHMENT" }
      return NoteAttachment(id, type, fileName, mimeType, size, duration)
    }

    fun parseHistory(raw: String): List<NoteHistoryEntry> {
      val rows = JSONObject(raw).getJSONArray("entries")
      require(rows.length() <= 500) { "INVALID_NOTE_HISTORY" }
      return (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        val timestamp = row.getLong("timestamp")
        val trigger = row.getString("trigger")
        require(timestamp > 0 && trigger in triggers) { "INVALID_NOTE_HISTORY" }
        NoteHistoryEntry(timestamp, trigger, row.optString("snippet").take(160))
      }
    }

    fun parseSnapshot(id: String, timestamp: Long, raw: String): NoteSnapshot {
      requireValidId(id)
      val row = JSONObject(raw).getJSONObject("snapshot")
      val markdown = row.getString("markdown")
      val trigger = row.getString("trigger")
      require(row.getString("noteId") == id && row.getLong("timestamp") == timestamp &&
        timestamp > 0 && trigger in triggers && markdown.length <= 2_000_000) {
        "INVALID_NOTE_SNAPSHOT"
      }
      val title = if (row.has("title") && !row.isNull("title"))
        row.getString("title").also { require(it.length <= 1000) { "INVALID_NOTE_SNAPSHOT" } }
      else null
      return NoteSnapshot(id, timestamp, trigger, title, markdown)
    }

    fun parseDeleteResponse(raw: String): Boolean = JSONObject(raw).get("deleted") == true

    fun parseShare(raw: String, note: NoteDetail): NoteShare {
      val envelope = JSONObject(raw)
      require(envelope.optBoolean("ok")) { "INVALID_NOTE_SHARE" }
      val payload = envelope.getJSONObject("payload")
      val id = payload.getString("id")
      val url = payload.getString("shareUrl")
      val reachability = payload.getString("reachability")
      val expiresAt = payload.getString("expiresAt")
      val uri = java.net.URI(url)
      require(id.matches(idPattern) && payload.getString("kind") == "note" &&
        uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank() &&
        uri.userInfo == null && url.length <= 4096 &&
        reachability in setOf("public", "lan", "local-only") &&
        expiresAt.length in 1..100) { "INVALID_NOTE_SHARE" }
      return NoteShare(note.id, id, note.title.ifBlank { payload.optString("fileName", "Note") }.take(1000),
        url, reachability, payload.optString("reachabilityHint").take(500), expiresAt)
    }

    private fun parseSummary(row: JSONObject): NoteSummary {
      val id = row.getString("id")
      requireValidId(id)
      val status = row.getString("status")
      val kind = row.getString("kind")
      require(status in statuses && kind in kinds) { "INVALID_NOTE" }
      val updatedAt = row.getLong("updatedAt")
      require(updatedAt >= 0) { "INVALID_NOTE" }
      val tags = row.optJSONArray("tags")?.let { values ->
        require(values.length() <= 100) { "INVALID_NOTE_TAGS" }
        (0 until values.length()).map { values.getString(it).take(512) }
      } ?: emptyList()
      return NoteSummary(id, row.optString("title").take(1000), row.optString("snippet").take(2000),
        status, kind, updatedAt, row.optBoolean("pinned"), tags)
    }
  }
}
