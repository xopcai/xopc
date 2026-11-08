package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ClarificationRepository
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.Socket
import java.net.URI
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Native approval card against the real Gateway/tools; not a full app navigation test. */
class ToolApprovalLiveTest {
  @get:Rule val compose = createComposeRule()
  private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
  private val context get() = instrumentation.targetContext
  private val config by lazy { JSONObject(context.openFileInput("approval-lab.json").bufferedReader().use { it.readText() }) }
  private fun label(id: Int) = context.getString(id)

  @Test fun approveExecutesOnce() = verify("approve")
  @Test fun denyDoesNotExecute() = verify("deny")
  @Test fun timeoutDoesNotExecute() = verify("expire")

  private fun verify(phase: String) {
    assumeTrue("Requires the isolated native approval fixture", File(context.filesDir, "approval-lab.json").isFile)
    val key = "android_$phase"
    val id = config.getJSONObject("conversations").getString(key)
    val gateway = config.getString("gateway")
    val lab = config.getString("lab")
    assertEquals(200, request(lab, "/lab/reset?phase=$key", "POST").first)
    val detail = request(gateway, "/api/sessions/$id").second.getJSONObject("session")
    val policy = request(gateway, "/api/sessions/$id/agent-config").second.getJSONObject("payload")
    val command = JSONObject().put("kind", "append").put("clientMessageId", UUID.randomUUID().toString())
      .put("expectedTranscriptId", detail.getString("transcriptId")).put("configVersion", policy.getLong("configVersion"))
      .put("delivery", "next").put("origin", JSONObject().put("type", "system").put("source", "cli"))
      .put("input", JSONObject().put("content", "APPROVAL_MOBILE_$key: run the command."))
    var snapshot = request(gateway, "/api/sessions/$id/clarification").second.getJSONObject("payload").optJSONObject("clarification")
    if (snapshot == null) assertEquals(202, request(gateway, "/api/sessions/$id/inputs", "POST", command).first)
    poll { snapshot = request(gateway, "/api/sessions/$id/clarification").second.getJSONObject("payload").optJSONObject("clarification"); snapshot != null }
    val pending = mutableStateOf(ClarificationRepository.parse(snapshot!!, id))
    val busy = mutableStateOf(false)
    val failure = mutableStateOf<String?>(null)
    compose.setContent {
      MaterialTheme {
        ClarificationCard(pending.value, busy.value, failure.value, { answer ->
          busy.value = true
          Thread {
            try {
              val response = request(gateway, "/api/clarifications/${pending.value.id}/responses", "POST",
                answer.body(pending.value.version, UUID.randomUUID().toString()))
              assertEquals(202, response.first)
            } catch (error: Throwable) { failure.value = error.toString() }
            finally { busy.value = false }
          }.start()
        })
      }
    }
    compose.onNodeWithText(label(R.string.clarify_approve)).performScrollTo().assertIsEnabled()
    Thread.sleep(1000)
    assertEquals(0, state(key).getInt("count"))
    screenshot("$key-pending")
    if (phase == "expire") {
      assertEquals(200, request(lab, "/lab/expire?phase=$key", "POST").first)
      val row = request(gateway, "/api/sessions/$id/clarification").second.getJSONObject("payload").getJSONObject("clarification")
      compose.runOnIdle { pending.value = ClarificationRepository.parse(row, id) }
      poll { pending.value.expired() }
      Thread.sleep(1200)
      compose.onNodeWithText(label(R.string.clarify_approve)).assertIsNotEnabled()
      compose.onNodeWithText(label(R.string.clarify_deny)).assertIsNotEnabled()
      val late = JSONObject().put("action", "answer").put("decision", "approve")
        .put("expectedVersion", pending.value.version).put("idempotencyKey", UUID.randomUUID().toString())
      assertTrue(request(gateway, "/api/clarifications/${pending.value.id}/responses", "POST", late).first in setOf(409, 410))
    } else {
      compose.onNodeWithText(label(if (phase == "approve") R.string.clarify_approve else R.string.clarify_deny)).performScrollTo().performClick()
      poll { val current = state(key)
        if (phase == "approve") current.getInt("count") == 1
        else current.getJSONObject("wait").has("approvalConsumedAt") }
      assertNull(failure.value)
    }
    Thread.sleep(1000)
    val final = state(key)
    assertEquals(if (phase == "approve") 1 else 0, final.getInt("count"))
    assertEquals(if (phase == "approve") 1 else 0, final.getJSONArray("receipts").length())
    screenshot("$key-completed")
  }

  private fun state(phase: String) = request(config.getString("lab"), "/lab/state?phase=$phase").second
  private fun poll(predicate: () -> Boolean) {
    val deadline = System.currentTimeMillis() + 35000
    while (System.currentTimeMillis() < deadline) { if (predicate()) return; Thread.sleep(250) }
    fail("The real Gateway operation did not reach the expected state")
  }
  private fun screenshot(name: String) {
    val file = File(context.getExternalFilesDir(null), "$name.png")
    file.outputStream().use { instrumentation.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
  }

  // adb reverse provides an isolated loopback HTTP transport. No production TLS
  // policy, response payload, repository parser or authorization gate is changed.
  private fun request(base: String, path: String, method: String = "GET", body: JSONObject? = null): Pair<Int, JSONObject> {
    val uri = URI(base)
    require(uri.host == "127.0.0.1")
    val bytes = body?.toString()?.toByteArray(Charsets.UTF_8) ?: byteArrayOf()
    Socket(uri.host, uri.port).use { socket ->
      socket.soTimeout = 30000
      val header = "$method $path HTTP/1.1\r\nHost: 127.0.0.1:${uri.port}\r\nAuthorization: Bearer ${config.getString("token")}\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
      socket.getOutputStream().write(header.toByteArray(Charsets.UTF_8) + bytes)
      val raw = socket.getInputStream().readBytes().toString(Charsets.UTF_8)
      val split = raw.indexOf("\r\n\r\n"); require(split >= 0)
      val headers = raw.substring(0, split)
      var data = raw.substring(split + 4)
      if (headers.contains("transfer-encoding: chunked", ignoreCase = true)) {
        val decoded = StringBuilder()
        while (true) {
          val end = data.indexOf("\r\n"); val size = data.substring(0, end).substringBefore(';').toInt(16)
          if (size == 0) break
          decoded.append(data.substring(end + 2, end + 2 + size)); data = data.substring(end + 2 + size + 2)
        }
        data = decoded.toString()
      }
      return headers.substringBefore("\r\n").split(' ')[1].toInt() to JSONObject(data)
    }
  }
}
