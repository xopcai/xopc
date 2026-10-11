package ai.xopc.mobile.gateway

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.util.TimeZone
import java.util.UUID
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** One foreground picker at a time. Late Activity results never belong to a subsequent call. */
internal object DevicePersonalTools {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var owner: ComponentActivity? = null
  private var picker: ActivityResultLauncher<Intent>? = null
  private var permissions: ActivityResultLauncher<String>? = null
  private var selection: CompletableDeferred<Uri?>? = null
  private var permission: CompletableDeferred<Unit>? = null
  private var resumed = CompletableDeferred<Unit>()
  private var job: Job? = null
  private var invocationId: String? = null
  private var cameraFile: File? = null
  private var cameraUri: Uri? = null
  private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()

  fun attach(activity: ComponentActivity, launcher: ActivityResultLauncher<Intent>, permissionLauncher: ActivityResultLauncher<String>) {
    owner = activity; picker = launcher; permissions = permissionLauncher
    resumed.complete(Unit)
  }
  fun detach(activity: ComponentActivity) {
    if (owner !== activity) return
    owner = null; resumed = CompletableDeferred()
    if (selection == null && permission == null) job?.cancel()
  }
  fun result(code: Int, intent: Intent?) {
    selection?.complete(if (code == Activity.RESULT_OK) cameraUri ?: intent?.data else null)
    selection = null
  }
  fun permissionResult() { permission?.complete(Unit); permission = null }
  fun cancel(id: String) { scope.launch { if (id == invocationId) job?.cancel() } }
  fun cancelAll() { scope.launch { job?.cancel() } }

  fun invoke(request: JSONObject, gateway: GatewaySession, send: (String, JSONObject) -> Unit) {
    scope.launch { start(request, gateway, send) }
  }
  private fun start(request: JSONObject, gateway: GatewaySession, send: (String, JSONObject) -> Unit) {
    val id = request.getString("invocationId")
    fun fail(code: String) { send("tool.error", JSONObject().put("invocationId", id).put("code", code).put("message", "Personal device request failed: $code")) }
    val name = request.optString("toolName")
    val names = listOf("mobile.file.pick", "mobile.media.pick", "mobile.camera.capture", "mobile.contacts.pick", "mobile.calendar.query_events", "mobile.calendar.query_free_busy")
    val index = names.indexOf(name)
    if (index < 0) { fail("TOOL_NOT_FOUND"); return }
    if (request.optString("descriptorRevision") != DeviceToolCatalog.revisions[index + 3]) { fail("TOOL_REVISION_MISMATCH"); return }
    val args = request.optJSONObject("arguments") ?: run { fail("INVALID_ARGUMENTS"); return }
    val calendar = name.startsWith("mobile.calendar.")
    val contact = name == "mobile.contacts.pick"
    val start = args.optLong("startAt", -1); val end = args.optLong("endAt", -1)
    if (request.optBoolean("confirmationRequired") != calendar ||
      (calendar && (args.length() != 2 || start < 0 || end <= start || end - start > 7 * 86400000L)) ||
      (contact && (args.length() != 1 || args.optString("field") !in listOf("phone", "email"))) ||
      (!calendar && !contact && args.length() != 0)) { fail("INVALID_ARGUMENTS"); return }
    if (owner == null) { fail("ENDPOINT_NOT_FOREGROUND"); return }
    if (job?.isActive == true || selection != null || permission != null) { fail("TOOL_BUSY"); return }
    val remaining = request.optLong("deadlineAt") - System.currentTimeMillis()
    if (remaining <= 0) { fail("TOOL_TIMEOUT"); return }
    val sourceProfile = gateway.currentProfile()
    if (sourceProfile == null) { fail("ENDPOINT_DISCONNECTED"); return }
    invocationId = id
    send("tool.received", JSONObject().put("invocationId", id))
    job = scope.launch {
      try {
        withTimeout(remaining.coerceAtMost(120000)) {
          val message = if (calendar) "读取本机可访问日历中 ${java.util.Date(start)} 至 ${java.util.Date(end)} 的${if (name.endsWith("free_busy")) "忙闲时间（不含标题）" else "时间和标题"}，最多 50 条。" else "请在接下来的系统页面选择本次要提供给 Agent 的${if (contact) "${if (args.getString("field") == "phone") "电话号码" else "邮箱"}" else "文件或照片"}。"
          if (!confirm(message + "所选内容会发送给 Agent，并可能保存在聊天历史中。")) { fail("USER_DENIED"); return@withTimeout }
          if (gateway.currentProfile() != sourceProfile) throw SecurityException()
          val content = when {
            calendar -> readCalendar(start, end, name.endsWith("free_busy"))
            contact -> readContact(args.getString("field"))
            else -> uploadSelection(name, request, gateway, sourceProfile)
          }
          ensureActive()
          resumed.await()
          if (owner == null) throw IllegalStateException("ENDPOINT_NOT_FOREGROUND")
          if (gateway.currentProfile()?.gatewayId != sourceProfile.gatewayId || gateway.currentProfile()?.gatewayPublicKey != sourceProfile.gatewayPublicKey) throw SecurityException()
          send("tool.result", JSONObject().put("invocationId", id).put("content", JSONArray().put(content)))
        }
      } catch (_: TimeoutCancellationException) { fail("TOOL_TIMEOUT") }
      catch (_: CancellationException) { send("tool.cancelled", JSONObject().put("invocationId", id)) }
      catch (error: Exception) { fail(error.message?.takeIf { it in listOf("USER_DENIED", "RESULT_TOO_LARGE", "ENDPOINT_NOT_FOREGROUND", "INVALID_ARGUMENTS") } ?: "PERMISSION_DENIED") }
      finally { cameraFile?.delete(); cameraFile = null; cameraUri = null; invocationId = null }
    }
  }

  private suspend fun confirm(message: String): Boolean = suspendCancellableCoroutine { continuation ->
    val activity = owner ?: run { continuation.resume(false); return@suspendCancellableCoroutine }
    val dialog = AlertDialog.Builder(activity).setTitle("允许本次提供设备信息？").setMessage(message)
      .setNegativeButton("拒绝") { _, _ -> if (continuation.isActive) continuation.resume(false) }
      .setPositiveButton("继续") { _, _ -> if (continuation.isActive) continuation.resume(true) }
      .setOnCancelListener { if (continuation.isActive) continuation.resume(false) }.create()
    continuation.invokeOnCancellation { scope.launch { dialog.dismiss() } }
    dialog.show()
  }
  private suspend fun allow(permissionName: String) {
    val activity = owner ?: throw IllegalStateException("ENDPOINT_NOT_FOREGROUND")
    if (ContextCompat.checkSelfPermission(activity, permissionName) != PackageManager.PERMISSION_GRANTED) {
      val wait = CompletableDeferred<Unit>(); permission = wait; permissions!!.launch(permissionName); wait.await(); resumed.await()
      if (ContextCompat.checkSelfPermission(activity, permissionName) != PackageManager.PERMISSION_GRANTED) throw SecurityException()
    }
  }
  private suspend fun pick(intent: Intent): Uri {
    val wait = CompletableDeferred<Uri?>(); selection = wait
    try { picker!!.launch(intent) } catch (error: Exception) { selection = null; throw error }
    val uri = wait.await() ?: throw IllegalStateException("USER_DENIED")
    resumed.await(); currentCoroutineContext().ensureActive()
    if (owner == null) throw IllegalStateException("ENDPOINT_NOT_FOREGROUND")
    return uri
  }
  private suspend fun readContact(field: String): JSONObject {
    val type = if (field == "phone") ContactsContract.CommonDataKinds.Phone.CONTENT_TYPE else ContactsContract.CommonDataKinds.Email.CONTENT_TYPE
    val uri = pick(Intent(Intent.ACTION_PICK).setType(type))
    val resolver = owner!!.contentResolver
    val column = if (field == "phone") ContactsContract.CommonDataKinds.Phone.NUMBER else ContactsContract.CommonDataKinds.Email.ADDRESS
    val value = resolver.query(uri, arrayOf(ContactsContract.Contacts.DISPLAY_NAME, column), null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) throw SecurityException()
      val name = cursor.getString(0)?.take(500)?.ifBlank { "Selected contact" } ?: "Selected contact"
      JSONObject().put("id", UUID.randomUUID().toString()).put("name", name)
        .put("phones", JSONArray().apply { if (field == "phone") put(cursor.getString(1).take(100)) })
        .put("emails", JSONArray().apply { if (field == "email") put(cursor.getString(1).take(320)) })
    } ?: throw SecurityException()
    return JSONObject().put("type", "json").put("value", value)
  }
  private suspend fun readCalendar(start: Long, end: Long, busyOnly: Boolean): JSONObject {
    allow(Manifest.permission.READ_CALENDAR)
    val resolver = owner!!.contentResolver
    val value = withContext(Dispatchers.IO) {
      val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().appendPath(start.toString()).appendPath(end.toString()).build()
      val fields = mutableListOf(CalendarContract.Instances.BEGIN, CalendarContract.Instances.END, CalendarContract.Events.ALL_DAY, CalendarContract.Events.AVAILABILITY)
      if (!busyOnly) fields.add(CalendarContract.Events.TITLE)
      val events = JSONArray(); var truncated = false
      resolver.query(uri, fields.toTypedArray(), "${CalendarContract.Instances.END} > ? AND ${CalendarContract.Instances.BEGIN} < ? AND ${CalendarContract.Events.STATUS} != ${CalendarContract.Events.STATUS_CANCELED}", arrayOf(start.toString(), end.toString()), "${CalendarContract.Instances.BEGIN} ASC")?.use { cursor ->
        while (cursor.moveToNext()) {
          ensureActive()
          if (events.length() == 50) { truncated = true; break }
          val entry = JSONObject().put("startAt", cursor.getLong(0)).put("endAt", cursor.getLong(1)).put("allDay", cursor.getInt(2) == 1)
            .put("busy", cursor.getInt(3) != CalendarContract.Events.AVAILABILITY_FREE)
          if (!busyOnly) entry.put("title", (cursor.getString(4) ?: "").take(500))
          events.put(entry)
        }
      } ?: throw SecurityException()
      JSONObject().put("capturedAt", System.currentTimeMillis()).put("startAt", start).put("endAt", end)
        .put("timeZone", TimeZone.getDefault().id).put("accessScope", "all_accessible").put("truncated", truncated).put("events", events)
    }
    return JSONObject().put("type", "json").put("value", value)
  }
  private suspend fun uploadSelection(name: String, request: JSONObject, gateway: GatewaySession, sourceProfile: GatewayProfile): JSONObject {
    val activity = owner!!
    val intent = when (name) {
      "mobile.media.pick" -> if (android.os.Build.VERSION.SDK_INT >= 33) Intent("android.provider.action.PICK_IMAGES").setType("image/*") else Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
      "mobile.camera.capture" -> {
        allow(Manifest.permission.CAMERA)
        val directory = File(activity.cacheDir, "camera-capture").apply { mkdirs() }
        cameraFile = File.createTempFile("agent-", ".jpg", directory)
        cameraUri = FileProvider.getUriForFile(activity, "${activity.packageName}.camera-capture", cameraFile!!)
        Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraUri)
          .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      else -> Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
    }
    val uri = pick(intent)
    val resolver = activity.contentResolver
    val grant = request.optJSONObject("uploadGrant") ?: throw SecurityException()
    val maxBytes = minOf(grant.getLong("maxBytes"), 10 * 1024 * 1024L)
    val fileName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else null
    }?.take(255) ?: "selected-file"
    val mime = resolver.getType(uri) ?: "application/octet-stream"
    val bytes = withContext(Dispatchers.IO) { resolver.openInputStream(uri)?.use { input ->
      val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
      while (true) { ensureActive(); val count = input.read(buffer); if (count < 0) break
        if (output.size() + count > maxBytes) throw IllegalStateException("RESULT_TOO_LARGE")
        output.write(buffer, 0, count)
      }; output.toByteArray()
    } ?: throw SecurityException() }
    try {
      resumed.await(); currentCoroutineContext().ensureActive()
      val auth = withContext(Dispatchers.IO) { gateway.voiceAuth() }
      val profile = gateway.currentProfile()?.takeIf { it.deviceId == sourceProfile.deviceId && it.gatewayId == sourceProfile.gatewayId && it.gatewayPublicKey == sourceProfile.gatewayPublicKey } ?: throw SecurityException()
      val path = grant.getString("path")
      if (path != "/api/endpoint-tools/invocations/${request.getString("invocationId")}/files" || grant.getLong("expiresAt") <= System.currentTimeMillis()) throw SecurityException()
      val url = (auth.origin + path).toHttpUrl().newBuilder().addQueryParameter("name", fileName).build()
      val upload = Request.Builder().url(url).header("Authorization", "Bearer ${auth.bearer}")
        .header("x-endpoint-id", "android:${profile.deviceId}").header("x-endpoint-upload-token", grant.getString("token"))
        .post(bytes.toRequestBody(mime.toMediaType())).build()
      val result = suspendCancellableCoroutine<String> { continuation ->
        val call = http.newCall(upload); continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
          override fun onFailure(call: Call, e: java.io.IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
          override fun onResponse(call: Call, response: Response) { response.use {
            if (continuation.isActive) { if (it.code == 201) continuation.resume(it.body.string()) else continuation.resumeWithException(SecurityException()) }
          } }
        })
      }
      currentCoroutineContext().ensureActive()
      return JSONObject(result).getJSONObject("payload")
    } finally { bytes.fill(0) }
  }
}
