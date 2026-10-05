package ai.xopc.mobile.gateway

import java.net.URLEncoder
import org.json.JSONObject

data class ManagedFileSpace(val id: String, val title: String, val writable: Boolean)
data class ManagedFile(val id: String, val spaceId: String, val name: String,
  val relativePath: String, val kind: String, val mimeType: String, val size: Long)

/** Read-only Files projection for the Notes tab and its search results. */
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
      val row = rows.getJSONObject(index)
      ManagedFile(row.getString("id"), row.getString("spaceId"), row.getString("name"),
        row.getString("relativePath"), row.getString("kind"),
        row.optString("mimeType"), row.optLong("size"))
    }
  }

  fun content(id: String): ByteArray {
    require(id.length in 1..512 && id.all { it.isLetterOrDigit() || it in "-_." }) {
      "INVALID_FILE_ID"
    }
    return gateway.requestBytes("/api/files/${encode(id)}/content")
  }

  fun text(id: String): String {
    val bytes = content(id)
    require(bytes.size <= 200_000) { "FILE_PREVIEW_TOO_LARGE" }
    return bytes.toString(Charsets.UTF_8)
  }

  private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}
