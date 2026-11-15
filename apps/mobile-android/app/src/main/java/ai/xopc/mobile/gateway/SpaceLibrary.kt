package ai.xopc.mobile.gateway

import android.os.SystemClock
import android.util.LruCache
import java.io.File
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import org.json.JSONObject

data class LibraryVersion(
  val id: String, val ordinal: Int, val fileName: String, val mimeType: String,
  val sizeBytes: Long, val createdAt: Long, val indexStatus: String, val music: LibraryMusic? = null,
) {
  val safeName: String get() = fileName.filterNot { it == '/' || it == '\\' || it.isISOControl() }
    .take(255).takeUnless { it.isBlank() || it == "." || it == ".." } ?: "attachment"
}

data class LibraryMusic(val id: String, val conversationId: String, val lyrics: String?, val durationMs: Int)

data class LibraryOrigin(
  val kind: String, val conversationId: String, val label: String?, val versionId: String?,
  val projectId: String?, val taskId: String?, val automationRunId: String?, val available: Boolean,
)

internal data class LibraryItem(
  val id: String, val title: String, val kind: String, val favorite: Boolean, val trashed: Boolean,
  val updatedAt: Long, val revision: Int, val currentVersion: LibraryVersion, val origin: LibraryOrigin?,
  val hit: String?, val versions: List<LibraryVersion>, val origins: List<LibraryOrigin>,
) {
  fun source(version: LibraryVersion): LibraryOrigin? =
    origins.firstOrNull { it.available && it.versionId == version.id }
      ?: origins.firstOrNull { it.available && it.versionId == null }
      ?: origin?.takeIf { it.available && (it.versionId == null || it.versionId == version.id) }
}

internal data class LibraryPage(val items: List<LibraryItem>, val cursor: String?)

class SpaceLibraryAccess internal constructor(private val gateway: GatewaySession) {
  private data class Snapshot(val page: LibraryPage, val time: Long)
  private val snapshots = LruCache<Triple<String, String, String>, Snapshot>(8)

  internal fun cached(profile: GatewayProfile, view: String, query: String, kind: String): LibraryPage? =
    snapshots.get(Triple(profile.gatewayId, profile.deviceId, endpoint(view, query, kind)))
      ?.takeIf { SystemClock.elapsedRealtime() - it.time < 30 * 60 * 1000 }?.page

  internal suspend fun page(profile: GatewayProfile, view: String, query: String, kind: String,
    cursor: String? = null): LibraryPage = scoped(profile) {
    val endpoint = endpoint(view, query, kind)
    val response = JSONObject(gateway.request(endpoint + (cursor?.let { "&cursor=" + encode(it) } ?: "")))
    val items = response.getJSONArray("items")
    val page = LibraryPage(List(items.length()) { parseItem(items.getJSONObject(it)) }, response.string("nextCursor"))
    if (cursor == null) snapshots.put(Triple(profile.gatewayId, profile.deviceId, endpoint),
      Snapshot(page, SystemClock.elapsedRealtime()))
    page
  }

  internal suspend fun detail(profile: GatewayProfile, id: String): LibraryItem =
    scoped(profile) { parseItem(JSONObject(gateway.request(itemPath(id)))) }

  internal suspend fun mutate(profile: GatewayProfile, id: String, revision: Int, action: String,
    title: String? = null, favorite: Boolean? = null): LibraryItem? = scoped(profile) {
    val body = JSONObject().put("revision", revision)
    title?.let { body.put("title", it) }
    favorite?.let { body.put("favorite", it) }
    val path = itemPath(id) + if (action in setOf("restore", "purge")) "/$action" else ""
    val method = when (action) { "patch" -> "PATCH"; "trash" -> "DELETE"; else -> "POST" }
    val response = gateway.request(path, method, body.toString())
    snapshots.evictAll()
    if (action == "patch") parseItem(JSONObject(response)) else null
  }

  suspend fun content(profile: GatewayProfile, id: String, version: LibraryVersion): ByteArray =
    scoped(profile) { gateway.requestBytes(contentPath(id, version.id)) }

  internal suspend fun download(profile: GatewayProfile, id: String, version: LibraryVersion,
    destination: File) = runInterruptible(Dispatchers.IO) {
    checkProfile(profile)
    gateway.downloadGeneratedMedia(contentPath(id, version.id), destination, profile.gatewayId)
    checkProfile(profile)
  }

  private suspend fun <T> scoped(profile: GatewayProfile, block: () -> T): T =
    runInterruptible(Dispatchers.IO) {
      synchronized(gateway) {
        checkProfile(profile)
        block()
      }
    }

  private fun checkProfile(profile: GatewayProfile) {
    val current = gateway.currentProfile()
    check(current?.gatewayId == profile.gatewayId && current.deviceId == profile.deviceId) { "GATEWAY_CHANGED" }
  }

  private fun endpoint(view: String, query: String, kind: String) =
    "/api/spaces/items?view=${encode(view)}&q=${encode(query)}" + if (kind.isEmpty()) "" else "&kind=${encode(kind)}"

  private fun itemPath(id: String) = "/api/spaces/items/${encode(id)}"
  private fun contentPath(id: String, version: String) = itemPath(id) + "/versions/${encode(version)}/content"
  private fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

  private fun parseVersion(value: JSONObject) = LibraryVersion(
    value.getString("id"), value.getInt("ordinal"), value.getString("fileName"), value.getString("mimeType"),
    value.getLong("sizeBytes"), value.getLong("createdAt"), value.getString("indexStatus"),
    value.optJSONObject("music")?.let {
      LibraryMusic(it.getString("id"), it.getString("conversationId"), it.string("lyrics"), it.optInt("durationMs", 0))
    },
  )

  private fun parseOrigin(value: JSONObject) = LibraryOrigin(
    value.getString("kind"), value.getString("conversationId"), value.string("label"), value.string("versionId"),
    value.string("projectId"), value.string("taskId"), value.string("automationRunId"), value.getBoolean("available"),
  )

  private fun parseItem(value: JSONObject) = LibraryItem(
    value.getString("id"), value.getString("title"), value.getString("kind"),
    value.getBoolean("favorite"), !value.isNull("trashedAt"), value.getLong("updatedAt"), value.getInt("revision"),
    parseVersion(value.getJSONObject("currentVersion")), value.optJSONObject("origin")?.let(::parseOrigin),
    value.optJSONObject("hit")?.string("text"),
    value.optJSONArray("versions")?.let { array -> List(array.length()) { parseVersion(array.getJSONObject(it)) } }.orEmpty(),
    value.optJSONArray("origins")?.let { array -> List(array.length()) { parseOrigin(array.getJSONObject(it)) } }.orEmpty(),
  )

  private fun JSONObject.string(key: String) = (opt(key) as? String)?.takeIf(String::isNotBlank)
}
