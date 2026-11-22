package ai.xopc.mobile.gateway

import android.content.Context
import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal data class VoiceNoteConsent(val version: Int, val acknowledged: Boolean)
internal data class PendingVoiceNote(val id: String, val recordedAt: Long, val noteId: String? = null, val segmented: Boolean = false)
internal data class VoiceNoteSegment(val index: Int, val startedAt: Long, val text: String, val speaker: String?)
internal data class VoiceNoteDetail(val id: String, val noteId: String, val title: String, val status: String,
  val audioSaved: Boolean, val failureStage: String?, val job: String?, val transcript: String,
  val segments: List<VoiceNoteSegment>, val summary: String, val keyPoints: List<String>,
  val durationMs: Long = 0, val localPending: Boolean = false, val audioDeleted: Boolean = false) {
  val settled get() = audioSaved || audioDeleted || status == "cancelled"
  val processing get() = job in setOf("queued", "running") || status in setOf("stopping", "sealing", "organizing")
  val canRetry get() = !processing && (status == "needs_attention" || job == "failed" || status == "recording" && localPending)
}

internal interface VoiceNotesGateway {
  suspend fun settings(gatewayId: String): VoiceNoteConsent
  suspend fun acknowledge(gatewayId: String, version: Int)
  suspend fun pending(gatewayId: String): List<PendingVoiceNote>
  suspend fun append(gatewayId: String, draft: PendingVoiceNote, sequence: Int, wav: ByteArray)
  suspend fun discard(gatewayId: String, draft: PendingVoiceNote)
  suspend fun publishLive(gatewayId: String, draft: PendingVoiceNote, fallback: Boolean): String?
  fun liveTranscription(gatewayId: String): VoiceNoteLive? = null
  suspend fun submit(gatewayId: String, draft: PendingVoiceNote): VoiceNoteDetail
  suspend fun detail(gatewayId: String, noteId: String): VoiceNoteDetail?
  suspend fun retry(gatewayId: String, detail: VoiceNoteDetail): VoiceNoteDetail
  suspend fun downloadAudio(gatewayId: String, detail: VoiceNoteDetail, destination: File)
}

internal class VoiceNotesAccess(context: Context, private val gateway: GatewaySession) : VoiceNotesGateway {
  private val recordings = ChatAttachmentStore(context)
  private val segmented = VoiceRecordingStore(context)
  private val records = AndroidSecureStore(context, "voice-note-records", "xopc.voice-note-records.v1")
  private val submissions = Mutex()

  override suspend fun settings(gatewayId: String): VoiceNoteConsent = scoped(gatewayId) { loadSettings() }

  override suspend fun acknowledge(gatewayId: String, version: Int) {
    scoped(gatewayId) {
      gateway.request(SETTINGS, "PUT", JSONObject().put("consentPolicyVersion", version).toString())
    }
  }

  override suspend fun pending(gatewayId: String): List<PendingVoiceNote> = runInterruptible(Dispatchers.IO) {
    (segmented.list(gatewayId) + legacyPending(gatewayId)).sortedByDescending { it.recordedAt }
  }

  override suspend fun append(gatewayId: String, draft: PendingVoiceNote, sequence: Int, wav: ByteArray) =
    runInterruptible(Dispatchers.IO) { segmented.append(gatewayId, draft, sequence, wav) }

  override suspend fun discard(gatewayId: String, draft: PendingVoiceNote) = submissions.withLock {
    scoped(gatewayId) {
      segmented.discussionId(gatewayId, draft.id)?.let { id ->
        requireVoiceId(id)
        try {
          gateway.request("/api/discussions/$id/cancel", "POST", "{}")
        } catch (error: GatewayHttpException) {
          if (error.status != 404) throw error
        }
      }
      forget(gatewayId, draft)
    }
  }

  override fun liveTranscription(gatewayId: String) = DiscussionLiveTranscription(gateway, gatewayId)

  override suspend fun publishLive(gatewayId: String, draft: PendingVoiceNote, fallback: Boolean): String? =
    submissions.withLock {
      scoped(gatewayId) {
        val count = segmented.count(gatewayId, draft.id)
        if (count == 0) return@scoped null
        val id = segmented.discussionId(gatewayId, draft.id) ?: openRecording(gatewayId, draft).id
        requireVoiceId(id)
        val path = "/api/discussions/$id"
        val sequence = segmented.originalCount(gatewayId, draft.id)
        if (sequence < count) uploadOriginal(gatewayId, draft, path, sequence)
        if (!fallback) return@scoped null

        // Pair the durable three-second originals to stay within the Gateway's live sequence limit.
        val liveSequence = count / 2 - 1
        if (liveSequence >= 0 && liveSequence > segmented.lastLiveSegment(gatewayId, draft.id)) {
          val first = segmented.read(gatewayId, draft.id, liveSequence * 2)
          val second = segmented.read(gatewayId, draft.id, liveSequence * 2 + 1)
          val pcm = first.copyOfRange(44, first.size) + second.copyOfRange(44, second.size)
          val bytes = voiceWav(pcm, pcm.size)
          val start = liveSequence * 6_000
          val end = start + pcm.size / VOICE_BYTES_PER_MS
          val boundary = "xopc-${UUID.randomUUID()}"
          val fields = mapOf("startedAtMs" to "$start", "endedAtMs" to "$end", "sha256" to DeviceRequestProof.digest(bytes))
          val prefix = fields.entries.joinToString("") { (name, value) ->
            "--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n"
          } + "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"segment.wav\"\r\n" +
            "Content-Type: audio/wav\r\n\r\n"
          gateway.writeProductMedia("$path/segments/$liveSequence", "PUT", "multipart/form-data; boundary=$boundary",
            listOf(prefix.toByteArray(), bytes, "\r\n--$boundary--\r\n".toByteArray()))
          segmented.markLiveSegment(gatewayId, draft.id, liveSequence)
        }
        JSONObject(gateway.request("$path/transcript")).optString("text").takeLast(4_000)
      }
    }

  override suspend fun submit(gatewayId: String, draft: PendingVoiceNote): VoiceNoteDetail = submissions.withLock {
    scoped(gatewayId) {
      val created = openRecording(gatewayId, draft)
      when {
        created.settled -> {
          forget(gatewayId, draft)
          created
        }
        created.job in setOf("queued", "running") -> created
        created.job == "failed" -> resume(created)
        else -> {
          val path = "/api/discussions/${created.id}"
          val seal = JSONObject().put("lastSequence", -1)
          if (draft.segmented) {
            val count = segmented.count(gatewayId, draft.id)
            check(count > 0) { "EMPTY_RECORDING" }
            for (sequence in segmented.originalCount(gatewayId, draft.id) until count) {
              if (Thread.currentThread().isInterrupted) throw InterruptedException()
              uploadOriginal(gatewayId, draft, path, sequence)
            }
            seal.put("chunkCount", count).put("mimeType", "audio/wav")
              .put("fileName", "recording.wav").put("containerMode", "independent_wav")
          } else {
            val item = recordings.list(gatewayId, SCOPE).single { it.id == draft.id }
            val bytes = requireNotNull(recordings.previewFile(gatewayId, SCOPE, item))
            gateway.writeProductMedia("$path/recording/chunks/0", "PUT", "application/octet-stream",
              listOf(bytes), mapOf("x-audio-sha256" to DeviceRequestProof.digest(bytes)))
            seal.put("chunkCount", 1).put("mimeType", "audio/mp4").put("fileName", "recording.m4a")
          }
          val result = JSONObject(gateway.request("$path/capture/seal", "POST", seal.toString()))
          created.copy(job = result.getString("state"), status = "stopping")
        }
      }
    }
  }

  override suspend fun detail(gatewayId: String, noteId: String): VoiceNoteDetail? = scoped(gatewayId) {
    requireVoiceId(noteId)
    val detail = try {
      parseVoiceNote(JSONObject(gateway.request("/api/discussions/by-note/$noteId")))
    } catch (error: GatewayHttpException) {
      if (error.status == 404) return@scoped null
      throw error
    }
    require(detail.noteId == noteId)
    val pending = (segmented.list(gatewayId) + legacyPending(gatewayId)).firstOrNull { it.noteId == noteId }
    if (pending != null && detail.settled) forget(gatewayId, pending)
    detail.copy(localPending = pending != null && !detail.settled)
  }

  override suspend fun retry(gatewayId: String, detail: VoiceNoteDetail): VoiceNoteDetail {
    val saved = if (!detail.settled) pending(gatewayId).firstOrNull { it.noteId == detail.noteId } else null
    return if (saved != null) submit(gatewayId, saved) else scoped(gatewayId) { resume(detail) }
  }

  override suspend fun downloadAudio(gatewayId: String, detail: VoiceNoteDetail, destination: File) = scoped(gatewayId) {
    requireVoiceId(detail.id)
    gateway.downloadVoiceRecording("/api/discussions/${detail.id}/audio", destination)
  }

  private fun openRecording(gatewayId: String, draft: PendingVoiceNote): VoiceNoteDetail {
    val consent = loadSettings()
    check(consent.acknowledged) { "DISCUSSION_CONSENT_REQUIRED" }
    val recordedAt = minOf(draft.recordedAt, gateway.nowMs()).coerceAtLeast(0L)
    val created = parseVoiceNote(JSONObject(gateway.request("/api/discussions", "POST", JSONObject()
      .put("clientRequestId", draft.id).put("recordedAt", recordedAt).put("source", "mobile")
      .put("consentPolicyVersion", consent.version).toString())))
    if (draft.segmented) segmented.link(gatewayId, draft.id, created.id, created.noteId)
    else records.write(recordKey(gatewayId, draft.id), created.noteId)
    return created
  }

  private fun uploadOriginal(gatewayId: String, draft: PendingVoiceNote, path: String, sequence: Int) {
    val bytes = segmented.read(gatewayId, draft.id, sequence)
    gateway.writeProductMedia("$path/recording/chunks/$sequence", "PUT", "application/octet-stream",
      listOf(bytes), mapOf("x-audio-sha256" to DeviceRequestProof.digest(bytes)))
    segmented.markOriginal(gatewayId, draft.id, sequence + 1)
  }

  private fun resume(detail: VoiceNoteDetail): VoiceNoteDetail {
    requireVoiceId(detail.id)
    return parseVoiceNote(JSONObject(gateway.request("/api/discussions/${detail.id}/retry", "POST",
      JSONObject().put("mode", "resume").toString())))
  }

  private fun loadSettings(): VoiceNoteConsent {
    val body = JSONObject(gateway.request(SETTINGS))
    return VoiceNoteConsent(body.getInt("consentPolicyVersion"), !body.isNull("consentAcknowledgedAt"))
  }

  private fun forget(gatewayId: String, draft: PendingVoiceNote) {
    if (draft.segmented) segmented.delete(gatewayId, draft.id)
    else {
      recordings.remove(gatewayId, SCOPE, draft.id)
      records.remove(recordKey(gatewayId, draft.id))
    }
  }

  private fun legacyPending(gatewayId: String): List<PendingVoiceNote> =
    recordings.list(gatewayId, SCOPE).mapNotNull { item ->
      item.name.removePrefix("voice-").removeSuffix(".m4a").toLongOrNull()?.let {
        PendingVoiceNote(item.id, it, records.read(recordKey(gatewayId, item.id)))
      }
    }

  private fun recordKey(gatewayId: String, id: String) = "voice.$gatewayId.$id"

  private suspend fun <T> scoped(gatewayId: String, block: () -> T): T = runInterruptible(Dispatchers.IO) {
    gateway.withActiveGateway(gatewayId, block)
  }

  private companion object {
    const val SCOPE = "22ab945e-f9c6-4702-844c-241b71b2f409"
    const val SETTINGS = "/api/discussion-capture/settings"
  }
}

internal fun parseVoiceNote(root: JSONObject): VoiceNoteDetail {
  val discussion = root.getJSONObject("discussion")
  val note = root.getJSONObject("note")
  val id = discussion.getString("id").also(::requireVoiceId)
  val noteId = note.getString("id").also(::requireVoiceId)
  require(noteId == discussion.getString("noteId"))
  val transcript = root.getJSONObject("transcript")
  val organization = root.optJSONObject("organization")?.optJSONObject("organization")
  val audioDeleted = !discussion.isNull("audioDeletedAt")
  return VoiceNoteDetail(id, noteId, note.optString("title", ""), discussion.getString("status"),
    discussion.optional("audioAttachmentId") != null && !audioDeleted,
    discussion.optional("failureStage"), root.optJSONObject("recordingJob")?.optional("state"),
    transcript.optString("text", ""), transcript.optJSONArray("segments").objects().mapNotNull { item ->
      val text = item.optional("displayText") ?: item.optional("rawText") ?: return@mapNotNull null
      VoiceNoteSegment(item.getInt("sequence"), item.optLong("startedAtMs"), text, item.optional("speakerLabel"))
    }, organization?.optString("summary", "").orEmpty(),
    organization?.optJSONArray("keyPoints")?.let { values -> (0 until values.length()).map { values.getString(it) } }
      .orEmpty(), discussion.optLong("durationMs"), audioDeleted = audioDeleted)
}

private fun JSONObject.optional(key: String): String? = (opt(key) as? String)?.takeIf { it.isNotBlank() }

private fun JSONArray?.objects(): List<JSONObject> =
  if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

private fun requireVoiceId(id: String) = require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "INVALID_VOICE_NOTE_ID" }
