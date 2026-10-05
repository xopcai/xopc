package ai.xopc.mobile.gateway

import java.net.URLEncoder
import org.json.JSONObject

data class NoteSummary(val id: String, val title: String, val snippet: String, val status: String,
  val kind: String, val updatedAt: Long, val pinned: Boolean, val tags: List<String>)
data class NotePage(val items: List<NoteSummary>, val total: Int, val hasMore: Boolean)
data class NoteDetail(val id: String, val title: String, val markdown: String, val status: String,
  val kind: String, val updatedAt: Long, val pinned: Boolean, val tags: List<String>,
  val remoteVersion: Long?)
data class NoteSyncResult(val note: NoteDetail, val conflict: Boolean)
data class NoteMetadataPatch(val pinned: Boolean? = null, val status: String? = null,
  val tags: List<String>? = null)
data class NoteHistoryEntry(val timestamp: Long, val trigger: String, val snippet: String)
data class NoteSnapshot(val noteId: String, val timestamp: Long, val trigger: String,
  val title: String?, val markdown: String)
data class NoteShare(val noteId: String, val id: String, val title: String, val url: String,
  val reachability: String, val hint: String, val expiresAt: String)

/** Bounded, authenticated projection of the Gateway's Notes list and detail. */
class NoteRepository(private val gateway: GatewaySession) {
  fun list(search: String = "", status: String = "", offset: Int = 0, limit: Int = 30): NotePage {
    require(search.length <= 4096 && status in setOf("", "inbox", "processed", "archived") &&
      offset >= 0 && limit in 1..100) { "INVALID_NOTE_QUERY" }
    val query = URLEncoder.encode(search.trim(), "UTF-8")
    val path = "/api/notes?limit=$limit&offset=$offset&sortBy=updatedAt&sortOrder=desc&search=$query" +
      if (status.isNotEmpty()) "&status=$status" else ""
    return parseList(gateway.request(path), offset)
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
    require(revision > 0 && listOf(patch.pinned, patch.status, patch.tags).count { it != null } == 1) {
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
      return NoteDetail(id, summary.title, markdown, summary.status, summary.kind,
        summary.updatedAt, summary.pinned, summary.tags, revision)
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
