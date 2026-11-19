package ai.xopc.mobile.gateway

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.OpenableColumns
import android.provider.MediaStore
import android.os.Build
import android.os.Environment
import androidx.annotation.RequiresApi
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
  private var permissions: ActivityResultLauncher<Array<String>>? = null
  private var selection: CompletableDeferred<Uri?>? = null
  private var permission: CompletableDeferred<Unit>? = null
  private var resumed = CompletableDeferred<Unit>()
  private var job: Job? = null
  private var invocationId: String? = null
  private var cameraFile: File? = null
  private var cameraUri: Uri? = null
  private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()

  fun attach(activity: ComponentActivity, launcher: ActivityResultLauncher<Intent>, permissionLauncher: ActivityResultLauncher<Array<String>>) {
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
  fun hasActiveInvocation(): Boolean = job?.isActive == true

  fun invoke(request: JSONObject, gateway: GatewaySession, send: (String, JSONObject) -> Unit) {
    scope.launch { start(request, gateway, send) }
  }
  private fun start(request: JSONObject, gateway: GatewaySession, send: (String, JSONObject) -> Unit) {
    val id = request.getString("invocationId")
    fun fail(code: String) { send("tool.error", JSONObject().put("invocationId", id).put("code", code).put("message", "Personal device request failed: $code")) }
    val name = request.optString("toolName")
    val names = listOf("mobile.file.pick", "mobile.media.pick", "mobile.camera.capture", "mobile.contacts.pick", "mobile.calendar.query_events", "mobile.calendar.query_free_busy", "mobile.contacts.find_by_name", "mobile.calendar.create_event", "mobile.media.list_recent", "mobile.media.read_image", "mobile.media.add_to_album")
    val index = names.indexOf(name)
    if (index < 0) { fail("TOOL_NOT_FOUND"); return }
    if (request.optString("descriptorRevision") != DeviceToolCatalog.revisions[index + 3]) { fail("TOOL_REVISION_MISMATCH"); return }
    val args = request.optJSONObject("arguments") ?: run { fail("INVALID_ARGUMENTS"); return }
    val calendar = name.startsWith("mobile.calendar.")
    val contact = name == "mobile.contacts.pick"
    val search = name == "mobile.contacts.find_by_name"
    val organize = name == "mobile.media.add_to_album"
    val photo = name == "mobile.media.read_image" || organize
    val album = args.optString("album").trim()
    if (organize && Build.VERSION.SDK_INT < 29) { fail("TOOL_NOT_FOUND"); return }
    val create = name == "mobile.calendar.create_event"
    val query = args.optString("query").trim()
    val title = args.optString("title").trim()
    val start = args.optLong("startAt", -1); val end = args.optLong("endAt", -1)
    if (request.optBoolean("confirmationRequired") != (create || organize) ||
      (calendar && (args.length() != (if (create) 3 else 2) || start < 0 || end <= start || end - start > 7 * 86400000L)) ||
      (contact && (args.length() != 1 || args.optString("field") !in listOf("phone", "email"))) ||
      (create && (args.opt("title") !is String || title.isEmpty() || title.length > 500)) ||
      (search && (args.length() != 1 || args.opt("query") !is String || query.isEmpty() || query.length > 100)) ||
      (photo && (args.length() != (if (organize) 2 else 1) || args.opt("id") !is String || args.optString("id").toLongOrNull()?.let { it > 0 } != true)) ||
      (organize && (args.opt("album") !is String || album.isEmpty() || album.length > 100 || album.startsWith(".") || album.any { it == '/' || it == '\\' || it.isISOControl() })) ||
      (!calendar && !contact && !search && !photo && args.length() != 0)) { fail("INVALID_ARGUMENTS"); return }
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
          if (name == "mobile.file.pick" || name == "mobile.camera.capture") {
            val message = "请在接下来的系统页面选择本次要提供给 Agent 的文件或照片。"
            if (!confirm(message + "所选内容会发送给 Agent，并可能保存在聊天历史中。")) { fail("USER_DENIED"); return@withTimeout }
          }
          if (gateway.currentProfile() != sourceProfile) throw SecurityException()
          val content = when {
            create -> {
              if (!confirm("创建日程「${title}」？\n${java.util.Date(start)} 至 ${java.util.Date(end)}")) {
                fail("USER_DENIED"); return@withTimeout
              }
              if (gateway.currentProfile() != sourceProfile) throw SecurityException()
              createEvent(start, end, title)
            }
            search -> findContacts(query)
            name == "mobile.media.list_recent" -> listPhotos()
            organize && Build.VERSION.SDK_INT >= 29 -> {
              if (!confirm("将这张照片复制到相册「${album}」？")) {
                fail("USER_DENIED"); return@withTimeout
              }
              if (gateway.currentProfile() != sourceProfile) throw SecurityException()
              addPhotoToAlbum(args.getString("id").toLong(), album)
            }
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
      requestPermissions(arrayOf(permissionName))
      if (ContextCompat.checkSelfPermission(activity, permissionName) != PackageManager.PERMISSION_GRANTED) throw SecurityException()
    }
  }
  private suspend fun requestPermissions(names: Array<String>) {
    val wait = CompletableDeferred<Unit>()
    permission = wait
    try { permissions!!.launch(names) } catch (error: Exception) { permission = null; throw error }
    wait.await()
    resumed.await()
    currentCoroutineContext().ensureActive()
  }
  private suspend fun allowPhotoAccess() {
    val activity = owner ?: throw IllegalStateException("ENDPOINT_NOT_FOREGROUND")
    val full = if (android.os.Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE
    val limited = Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
    fun granted(): Boolean = ContextCompat.checkSelfPermission(activity, full) == PackageManager.PERMISSION_GRANTED ||
      (android.os.Build.VERSION.SDK_INT >= 34 && ContextCompat.checkSelfPermission(activity, limited) == PackageManager.PERMISSION_GRANTED)
    if (!granted()) requestPermissions(if (android.os.Build.VERSION.SDK_INT >= 34) arrayOf(full, limited) else arrayOf(full))
    if (!granted()) throw SecurityException()
  }
  private suspend fun listPhotos(): JSONObject {
    allowPhotoAccess()
    val resolver = owner!!.contentResolver
    val photos = withContext(Dispatchers.IO) {
      val results = JSONArray()
      val images = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      val fields = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_TAKEN)
      resolver.query(images, fields, null, null, "${MediaStore.Images.Media.DATE_TAKEN} DESC, ${MediaStore.Images.Media._ID} DESC")?.use { cursor ->
        while (results.length() < 20 && cursor.moveToNext()) {
          ensureActive()
          results.put(JSONObject().put("id", cursor.getString(0)).put("capturedAt", cursor.getLong(1).coerceAtLeast(0)))
        }
      } ?: throw SecurityException()
      results
    }
    return JSONObject().put("type", "json").put("value", photos)
  }

  @RequiresApi(29)
  private suspend fun addPhotoToAlbum(id: Long, album: String): JSONObject {
    allowPhotoAccess()
    val resolver = owner!!.contentResolver
    val addedId = withContext(Dispatchers.IO) {
      val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      val source = ContentUris.withAppendedId(collection, id)
      val displayName = resolver.query(source, arrayOf(MediaStore.Images.Media.DISPLAY_NAME), null, null, null)
        ?.use { if (it.moveToFirst()) it.getString(0) else null } ?: throw SecurityException()
      val mimeType = resolver.getType(source)?.takeIf { it.startsWith("image/") } ?: throw SecurityException()
      val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
        put(MediaStore.Images.Media.MIME_TYPE, mimeType)
        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + album)
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
      ensureActive()
      val destination = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values) ?: throw SecurityException()
      try {
        resolver.openInputStream(source)?.use { input ->
          resolver.openOutputStream(destination)?.use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              ensureActive()
              val count = input.read(buffer)
              if (count < 0) break
              output.write(buffer, 0, count)
            }
          } ?: throw SecurityException()
        } ?: throw SecurityException()
        ensureActive()
        val completed = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
        if (resolver.update(destination, completed, null, null) != 1) throw SecurityException()
        ContentUris.parseId(destination)
      } catch (error: Exception) {
        runCatching { resolver.delete(destination, null, null) }
        throw error
      }
    }
    return JSONObject().put("type", "json").put("value", JSONObject().put("id", addedId.toString()))
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
  private suspend fun findContacts(query: String): JSONObject {
    allow(Manifest.permission.READ_CONTACTS)
    val resolver = owner!!.contentResolver
    val matches = withContext(Dispatchers.IO) {
      val contacts = ContactsContract.Contacts.CONTENT_FILTER_URI.buildUpon().appendPath(query).build()
      val data = ContactsContract.Data.CONTENT_URI
      val results = JSONArray()
      resolver.query(contacts, arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME), null, null, null)?.use { cursor ->
        while (results.length() < 20 && cursor.moveToNext()) {
          ensureActive()
          val id = cursor.getString(0)
          val name = cursor.getString(1)?.take(500) ?: continue
          if (!name.contains(query, ignoreCase = true)) continue
          val phones = JSONArray()
          val emails = JSONArray()
          resolver.query(data, arrayOf(ContactsContract.Data.MIMETYPE, ContactsContract.Data.DATA1),
            "${ContactsContract.Data.CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} IN (?, ?)",
            arrayOf(id, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE), null)?.use { fields ->
            while (fields.moveToNext()) {
              val value = fields.getString(1) ?: continue
              if (fields.getString(0) == ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE) {
                if (phones.length() < 20) phones.put(value.take(100))
              } else if (emails.length() < 20) emails.put(value.take(320))
            }
          }
          results.put(JSONObject().put("id", id).put("name", name).put("phones", phones).put("emails", emails))
        }
      } ?: throw SecurityException()
      results
    }
    return JSONObject().put("type", "json").put("value", matches)
  }

  private suspend fun createEvent(start: Long, end: Long, title: String): JSONObject {
    allow(Manifest.permission.READ_CALENDAR)
    allow(Manifest.permission.WRITE_CALENDAR)
    val resolver = owner!!.contentResolver
    val id = withContext(Dispatchers.IO) {
      val calendars = CalendarContract.Calendars.CONTENT_URI
      val calendarId = resolver.query(calendars, arrayOf(CalendarContract.Calendars._ID),
        "${CalendarContract.Calendars.VISIBLE} = 1 AND ${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ?",
        arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString()),
        "${CalendarContract.Calendars.IS_PRIMARY} DESC, ${CalendarContract.Calendars._ID} ASC")?.use {
        if (it.moveToFirst()) it.getLong(0) else null
      } ?: throw SecurityException()
      ensureActive()
      val values = ContentValues().apply {
        put(CalendarContract.Events.CALENDAR_ID, calendarId)
        put(CalendarContract.Events.TITLE, title)
        put(CalendarContract.Events.DTSTART, start)
        put(CalendarContract.Events.DTEND, end)
        put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
      }
      resolver.insert(CalendarContract.Events.CONTENT_URI, values)?.lastPathSegment ?: throw SecurityException()
    }
    return JSONObject().put("type", "json").put("value", JSONObject().put("id", id))
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
    val uri = if (name == "mobile.media.read_image") {
      allowPhotoAccess()
      val id = request.getJSONObject("arguments").getString("id").toLong()
      ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
    } else pick(when (name) {
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
    })
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
        .header("X-Xopc-Proof", DeviceRequestProof.upload(auth.bearer, "POST", url.encodedPath + (url.encodedQuery?.let { "?$it" } ?: ""), bytes,
          listOf(mime, "", "", "android:${profile.deviceId}", grant.getString("token"))))
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
