package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.PendingVoiceNote
import ai.xopc.mobile.gateway.VoiceNoteConsent
import ai.xopc.mobile.gateway.VoiceNoteDetail
import ai.xopc.mobile.gateway.VoiceNotesGateway
import ai.xopc.mobile.gateway.VoiceNoteLive
import java.io.File
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
import android.Manifest
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class VoiceNoteJourneyTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun capsTwoHoursOfPcmAndFlushesPartialRecordings() {
    val whole = VoicePcmChunks()
    val frame = ByteArray(640) { 23 }
    val framesPerSecond = 50
    var completeChunks = 0
    repeat(120 * 60 * framesPerSecond + 1) {
      whole.append(frame)?.let { wav ->
        assertEquals(96_044, wav.size)
        assertEquals(23.toByte(), wav.last())
        completeChunks++
      }
    }
    assertTrue(whole.atLimit)
    assertEquals(230_400_000, whole.bytes)
    assertEquals(2400, completeChunks)
    assertEquals(null, whole.takeTail())

    val short = VoicePcmChunks()
    short.append(frame)
    assertEquals(684, short.takeTail()?.size)
    assertEquals(null, short.takeTail())
  }

  @Test fun recordsPausesAndResumesThenReopensSavedOriginalAndRetriesTranscription() {
    InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
      rule.activity.packageName, Manifest.permission.RECORD_AUDIO)
    val access = VoiceFixture()
    var selected = ""
    rule.setContent {
      NotesScreen(NotesUiState(gatewayId = "testing"), PaddingValues(), { _, _ -> }, {},
        { selected = it }, voiceNotes = access, onExit = {})
    }
    rule.onNodeWithTag("notes-new-voice").performClick()
    rule.onNodeWithTag("voice-note-consent").performClick()
    rule.onNodeWithTag("voice-note-record").performClick()
    rule.onNodeWithTag("voice-note-timer").assertExists()
    rule.waitUntil(5_000) { rule.onAllNodesWithText("Speaking now").fetchSemanticsNodes().isNotEmpty() }
    rule.onNodeWithTag("voice-note-pause").performClick()
    rule.onNodeWithTag("voice-note-pause").assertTextContains(rule.activity.getString(ai.xopc.mobile.R.string.voice_note_resume))
    val pausedAt = access.frames
    SystemClock.sleep(300)
    assertTrue(access.frames <= pausedAt + 1)
    rule.onNodeWithTag("voice-note-pause").performClick()
    rule.waitUntil(5_000) { rule.onAllNodesWithText("More speech").fetchSemanticsNodes().isNotEmpty() }
    SystemClock.sleep(700)
    rule.onNodeWithTag("voice-note-finish").performClick()
    rule.waitUntil(8_000) { rule.onAllNodesWithTag("voice-note-upload-retry").fetchSemanticsNodes().isNotEmpty() }
    rule.onNodeWithTag("voice-note-error").assertExists()
    rule.onNodeWithTag("voice-note-back").performClick()
    rule.waitUntil(5_000) { rule.onAllNodesWithTag("notes-recover-voice").fetchSemanticsNodes().isNotEmpty() }
    rule.onNodeWithTag("notes-recover-voice").performClick()
    rule.onNodeWithTag("voice-note-upload-retry").performClick()
    rule.waitUntil(6_000) { rule.onAllNodesWithTag("voice-note-result-retry").fetchSemanticsNodes().isNotEmpty() }
    val playback = rule.onNodeWithTag("voice-note-playback")
    playback.performClick()
    val pauseLabel = rule.activity.getString(ai.xopc.mobile.R.string.voice_note_pause)
    rule.waitUntil(5_000) {
      rule.onAllNodes(hasTestTag("voice-note-playback") and hasText(pauseLabel)).fetchSemanticsNodes().isNotEmpty()
    }
    playback.performClick()
    rule.onNodeWithTag("voice-note-result-retry").performClick()
    rule.waitUntil(6_000) { rule.onAllNodesWithTag("voice-note-summary").fetchSemanticsNodes().isNotEmpty() }
    rule.onNodeWithTag("voice-note-summary").assertTextContains("Summary of the discussion")
    rule.onNodeWithTag("voice-note-tab-transcript").performClick()
    rule.onNodeWithText("The transcript is ready").assertExists()
    rule.runOnIdle {
      assertEquals("note-voice", selected)
      assertEquals(2, access.submitted.size)
      assertEquals(access.submitted[0], access.submitted[1])
      assertEquals(1, access.confirmedRetries)
      assertTrue(access.audio.size > 12)
      assertEquals("RIFF", access.audio.copyOfRange(0, 4).decodeToString())
      assertTrue(access.didCommit)
    }
  }

  @Test fun showsSegmentTranscriptWhileRecordingWhenRealtimeIsUnavailable() {
    InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
      rule.activity.packageName, Manifest.permission.RECORD_AUDIO)
    val access = VoiceFixture(realtime = false)
    rule.setContent {
      VoiceNoteCapture("testing", access, PaddingValues(), onClose = {}, onOpen = {})
    }
    rule.onNodeWithTag("voice-note-consent").performClick()
    rule.onNodeWithTag("voice-note-record").performClick()
    rule.waitUntil(13_000) {
      rule.onAllNodesWithText("Segment transcript").fetchSemanticsNodes().isNotEmpty()
    }
    rule.onNodeWithTag("voice-note-finish").assertExists().performClick()
    rule.waitUntil(5_000) { rule.onAllNodesWithTag("voice-note-upload-retry").fetchSemanticsNodes().isNotEmpty() }
  }

  private class VoiceFixture(private val realtime: Boolean = true) : VoiceNotesGateway {
    private var chunks = 0
    var audio = byteArrayOf()
    @Volatile var frames = 0
    @Volatile var didCommit = false
    private var resumedAt = 0
    private val stream = object : VoiceNoteLive {
      override val available = MutableStateFlow(false)
      override val transcript = MutableStateFlow("")
      override suspend fun connect() {
        available.value = true
        try { awaitCancellation() } finally { available.value = false }
      }
      override fun audio(pcm: ByteArray) {
        check(pcm.size == 640)
        frames++
        if (available.value && frames == 5) {
          resumedAt = 35
          transcript.value = "Speaking now"
        }
        if (available.value && frames == resumedAt) transcript.value = "Speaking now\nMore speech"
      }
      override fun commit() { didCommit = true }
    }
    private var didAcknowledge = false
    private var draft: PendingVoiceNote? = null
    val submitted = mutableListOf<String>()
    var confirmedRetries = 0
    private var detailReads = 0
    private var detail = VoiceNoteDetail("discussion", "note-voice", "Recorded voice note", "sealing",
      true, null, "completed", "", emptyList(), "", emptyList())

    override suspend fun settings(gatewayId: String) = VoiceNoteConsent(1, didAcknowledge)
    override suspend fun acknowledge(gatewayId: String, version: Int) { didAcknowledge = true }
    override suspend fun pending(gatewayId: String) = listOfNotNull(draft)
    override fun liveTranscription(gatewayId: String): VoiceNoteLive? = stream.takeIf { realtime }
    override suspend fun publishLive(gatewayId: String, draft: PendingVoiceNote, fallback: Boolean): String? =
      "Segment transcript".takeIf { fallback && chunks >= 2 }
    override suspend fun discard(gatewayId: String, draft: PendingVoiceNote) { this.draft = null }
    override suspend fun append(gatewayId: String, draft: PendingVoiceNote, sequence: Int, wav: ByteArray) {
      chunks++
      this.audio = wav
      this.draft = draft
    }
    override suspend fun submit(gatewayId: String, draft: PendingVoiceNote): VoiceNoteDetail {
      submitted += draft.id
      if (submitted.size == 1) error("OFFLINE")
      this.draft = null
      return detail
    }
    override suspend fun detail(gatewayId: String, noteId: String): VoiceNoteDetail {
      if (++detailReads == 2) detail = detail.copy(status = "needs_attention", failureStage = "transcript_sealing")
      return detail
    }
    override suspend fun retry(gatewayId: String, detail: VoiceNoteDetail): VoiceNoteDetail {
      confirmedRetries++
      return detail.copy(status = "completed", transcript = "The transcript is ready",
        summary = "Summary of the discussion", failureStage = null).also { this.detail = it }
    }
    override suspend fun downloadAudio(gatewayId: String, detail: VoiceNoteDetail, destination: File) {
      destination.writeBytes(audio)
    }
  }
}
