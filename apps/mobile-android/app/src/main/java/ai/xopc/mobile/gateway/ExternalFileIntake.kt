package ai.xopc.mobile.gateway

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.AtomicFile
import androidx.core.content.IntentCompat
import java.io.File
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

data class ExternalFileBatch(val id: String, val createdAt: Long, val files: List<ChatAttachment>,
  val errors: List<String>, val targetGateway: String? = null, val targetDevice: String? = null,
  val targetConversation: String? = null)

/** Capture transient URI grants immediately; keep bytes encrypted in the attachment store. */
class ExternalFileIntake private constructor(context: Context) {
  private val app = context.applicationContext
  private val attachments = ChatAttachmentStore(app)
  private val directory = File(app.filesDir, "external-intake").apply { mkdirs() }
  private val mutableBatches = MutableStateFlow<List<ExternalFileBatch>>(emptyList())
  val batches = mutableBatches.asStateFlow()

  @Synchronized
  fun refresh() {
    val pending = directory.listFiles().orEmpty().filter { it.extension == "json" }.mapNotNull { file ->
      runCatching {
        val data = JSONObject(AtomicFile(file).readFully().toString(Charsets.UTF_8))
        val id = UUID.fromString(data.getString("id")).toString()
        ExternalFileBatch(id, data.getLong("createdAt"), attachments.list(STAGING_GATEWAY, id),
          data.getJSONArray("errors").let { list -> (0 until list.length()).map { list.getString(it) } },
          data.optString("gateway").ifBlank { null }, data.optString("device").ifBlank { null },
          data.optString("conversation").ifBlank { null })
      }.getOrNull()
    }
    pending.filter { it.targetConversation == null && System.currentTimeMillis() - it.createdAt > 86_400_000 }.forEach { batch ->
      attachments.removeConversation(STAGING_GATEWAY, batch.id); manifest(batch.id).delete()
    }
    mutableBatches.value = pending.filter { it.targetConversation != null || System.currentTimeMillis() - it.createdAt <= 86_400_000 }.sortedBy { it.createdAt }
  }

  @Synchronized
  fun capture(intent: Intent) {
    if (intent.action !in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE, Intent.ACTION_VIEW)) return
    val uris = linkedSetOf<Uri>()
    if (intent.action == Intent.ACTION_VIEW) intent.data?.let(uris::add)
    if (intent.action == Intent.ACTION_SEND) IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let(uris::add)
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let(uris::addAll)
    intent.clipData?.let { clip -> for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(uris::add) }
    if (uris.isEmpty()) return
    val id = UUID.randomUUID().toString()
    val errors = mutableListOf<String>()
    val createdAt = System.currentTimeMillis()
    save(ExternalFileBatch(id, createdAt, emptyList(), listOf("File import was interrupted. Share any missing files again.")))
    uris.forEach { uri ->
      try {
        require(uri.scheme == "content") { "Only shared content URIs are supported" }
        attachments.import(STAGING_GATEWAY, id, uri)
      } catch (error: Exception) { errors += "${uri.lastPathSegment?.take(80) ?: "File"}: ${error.message}" }
    }
    save(ExternalFileBatch(id, createdAt, attachments.list(STAGING_GATEWAY, id), errors))
    refresh()
  }

  @Synchronized
  fun bind(batch: ExternalFileBatch, gateway: String, device: String, conversation: String) {
    val saved = mutableBatches.value.firstOrNull { it.id == batch.id } ?: error("INTAKE_NOT_FOUND")
    require(saved.targetGateway == null || saved.targetGateway == gateway && saved.targetDevice == device && saved.targetConversation == conversation) { "INTAKE_TARGET_CHANGED" }
    save(saved.copy(targetGateway = gateway, targetDevice = device, targetConversation = conversation)); refresh()
  }

  @Synchronized
  fun commit(batch: ExternalFileBatch, gateway: String, conversation: String): List<ChatAttachment> {
    try { return attachments.appendIntake(batch.id, gateway, conversation) }
    catch (error: IllegalArgumentException) {
      if (error.message in setOf("ATTACHMENT_LIMIT_10", "ATTACHMENT_TOTAL_LIMIT_20_MB")) {
        save(batch.copy(targetGateway = null, targetDevice = null, targetConversation = null)); refresh()
      }
      throw error
    }
  }

  @Synchronized
  fun dismiss(id: String) {
    // Remove the manifest first: a crash must never expose an already completed batch again.
    manifest(id).delete(); attachments.removeConversation(STAGING_GATEWAY, id); refresh()
  }

  private fun manifest(id: String): AtomicFile = AtomicFile(File(directory, "${UUID.fromString(id)}.json"))
  private fun save(batch: ExternalFileBatch) {
    val file = manifest(batch.id)
    val stream = file.startWrite()
    try {
      stream.write(JSONObject().put("id", batch.id).put("createdAt", batch.createdAt)
        .put("errors", JSONArray(batch.errors)).put("gateway", batch.targetGateway ?: "")
        .put("device", batch.targetDevice ?: "").put("conversation", batch.targetConversation ?: "")
        .toString().toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
    } catch (error: Exception) { file.failWrite(stream); throw error }
  }

  companion object {
    const val STAGING_GATEWAY = "00000000-0000-4000-8000-000000000001"
    @Volatile private var instance: ExternalFileIntake? = null
    fun get(context: Context): ExternalFileIntake = instance ?: synchronized(this) {
      instance ?: ExternalFileIntake(context).also { instance = it }
    }
  }
}
