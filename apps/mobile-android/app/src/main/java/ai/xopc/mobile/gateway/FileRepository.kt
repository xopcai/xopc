package ai.xopc.mobile.gateway

import java.net.URLEncoder
import org.json.JSONObject
import java.util.UUID

data class ManagedFileSpace(val id: String, val title: String, val writable: Boolean)
data class ManagedFile(val id: String, val spaceId: String, val name: String,
  val relativePath: String, val kind: String, val mimeType: String, val size: Long,
  val revision: String = "", val capabilities: Set<String> = emptySet()) {
  val canSaveVersion: Boolean
    get() = kind == "file" && size <= 8 * 1024 * 1024 && revision.isNotBlank() && "save_version" in capabilities
}

class FileRepository(private val gateway: GatewaySession) {
  fun spaces(): List<ManagedFileSpace> {
    val rows = JSONObject(gateway.request("/api/files/spaces")).getJSONArray("spaces")
    require(rows.length() <= 100) { "INVALID_FILE_SPACES" }
    return (0 until rows.length()).map { index ->
      val row = rows.getJSONObject(index)
      ManagedFileSpace(row.getString("id"), row.getString("title"), row.optBoolean("writable"))
    }
  }

  fun list(spaceId: String? = null, path: String = "", search: String = ""): List<ManagedFile> {
    require(search.length <= 4096 && path.length <= 4096) { "INVALID_FILE_QUERY" }
    val route = when {
      search.isNotBlank() -> "/api/files/search?q=${encode(search.trim())}&limit=50" +
        (spaceId?.let { "&spaceId=${encode(it)}" } ?: "")
      spaceId != null -> "/api/files/spaces/${encode(spaceId)}/children?path=${encode(path)}"
      else -> "/api/files/recent?limit=50"
    }
    val rows = JSONObject(gateway.request(route)).getJSONArray("items")
    require(rows.length() <= 50) { "INVALID_FILE_LIST" }
    return (0 until rows.length()).map { index ->
      parseFile(rows.getJSONObject(index))
    }
  }

  fun resource(id: String): ManagedFile {
    requireValidFileId(id)
    return parseFile(
      JSONObject(gateway.request("/api/files/${encodeSegment(id)}")).getJSONObject("resource"),
    )
  }

  fun resolveConversationFile(conversationId: String, media: ConversationMedia): ManagedFile? {
    if (media.uri.startsWith("xopc-file:")) {
      return resource(android.net.Uri.decode(media.uri.removePrefix("xopc-file:")))
    }
    media.fileId?.let { return resource(it) }
    val path = media.workspaceRelativePath?.takeIf(String::isNotBlank) ?: return null
    requireValidFileId(conversationId)
    val spaceId = JSONObject(gateway.request("/api/files/contexts/session/${encodeSegment(conversationId)}"))
      .getJSONObject("space").getString("id")
    val body = JSONObject().put("spaceId", spaceId).put("path", path)
    return parseFile(JSONObject(gateway.request("/api/files/resolve", "POST", body.toString()))
      .getJSONObject("resource"))
  }

  fun saveVersion(file: ManagedFile, requestId: String) {
    require(file.canSaveVersion) { "FILE_VERSION_UNAVAILABLE" }
    requireValidFileId(file.id)
    UUID.fromString(requestId)
    val body = JSONObject().put("id", requestId).put("revision", file.revision)
    val result = JSONObject(gateway.request("/api/files/${encodeSegment(file.id)}/versions", "POST", body.toString()))
    require(result.getJSONObject("version").getString("id") == requestId) { "INVALID_FILE_VERSION" }
  }

  private fun parseFile(row: JSONObject): ManagedFile {
    val capabilities = row.optJSONArray("capabilities")
    return ManagedFile(row.getString("id"), row.getString("spaceId"), row.getString("name"),
      row.getString("relativePath"), row.getString("kind"), row.optString("mimeType"), row.optLong("size"),
      row.optString("revision"), (0 until (capabilities?.length() ?: 0)).mapNotNull {
        capabilities?.optString(it)?.takeIf(String::isNotBlank)
      }.toSet())
  }

  fun content(id: String): ByteArray {
    requireValidFileId(id)
    return gateway.requestBytes("/api/files/${encodeSegment(id)}/content")
  }

  fun text(id: String): String {
    val bytes = content(id)
    require(bytes.size <= 200_000) { "FILE_PREVIEW_TOO_LARGE" }
    return bytes.toString(Charsets.UTF_8)
  }

  private fun requireValidFileId(id: String) {
    require(id.length in 1..512 && id != "." && id != ".." && id.all { it.isLetterOrDigit() || it in "-_." }) {
      "INVALID_FILE_ID"
    }
  }

  private fun encodeSegment(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

  private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}
