package ai.xopc.mobile.gateway

import android.net.Uri
import android.graphics.Bitmap
import java.io.ByteArrayOutputStream
import android.content.ContentValues
import android.provider.MediaStore
import androidx.test.core.app.ApplicationProvider
import android.content.Context
import android.content.Intent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import java.io.File
import java.util.Base64
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatAttachmentStoreTest {
  @Test fun externalFilesPreserveExistingAttachmentsAndReceiptSurvivesRetryAfterSend() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val intake = ExternalFileIntake.get(context)
    val uri = CameraCaptureStore.create(context)
    val gateway = UUID.randomUUID().toString()
    val conversation = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    var batch: ExternalFileBatch? = null
    try {
      context.contentResolver.openOutputStream(uri)!!.use { it.write(byteArrayOf(0, 1, 2, 3)) }
      intake.refresh()
      val before = intake.batches.value.map { it.id }.toSet()
      intake.capture(Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, uri))
      batch = intake.batches.value.single { it.id !in before }
      val captured = batch
      CameraCaptureStore.discard(context, uri)
      val existing = store.addBytes(gateway, conversation, "existing.txt", "text/plain", byteArrayOf(9))
      intake.bind(captured, gateway, "device", conversation)
      val files = intake.commit(captured, gateway, conversation)
      assertEquals(2, files.size)
      assertTrue(files.any { it.id == existing.id })
      val imported = files.single { it.id != existing.id }
      assertEquals(listOf(0, 1, 2, 3), Base64.getDecoder().decode(store.wirePayloads(gateway, conversation, listOf(imported))
        .getJSONObject(0).getString("data")).map { it.toInt() })
      assertEquals(2, intake.commit(captured, gateway, conversation).size)
      store.removeConversation(gateway, conversation)
      assertTrue(intake.commit(captured, gateway, conversation).isEmpty())
    } finally {
      batch?.let { intake.dismiss(it.id) }
      store.removeGateway(gateway)
      CameraCaptureStore.discard(context, uri)
    }
  }

  @Test fun externalMultiShareKeepsOneBatchAndRegistersSystemOpenTargets() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val intake = ExternalFileIntake.get(context)
    val first = CameraCaptureStore.create(context)
    val second = CameraCaptureStore.create(context)
    var batch: ExternalFileBatch? = null
    try {
      for (uri in listOf(first, second)) context.contentResolver.openOutputStream(uri)!!.use { it.write(byteArrayOf(1, 2, 3)) }
      for (action in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE, Intent.ACTION_VIEW)) {
        val probe = Intent(action).setDataAndType(first, "image/jpeg").setPackage(context.packageName)
        assertTrue(context.packageManager.queryIntentActivities(probe, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
          .any { it.activityInfo.name == "ai.xopc.mobile.MainActivity" })
      }
      intake.refresh(); val before = intake.batches.value.map { it.id }.toSet()
      val intent = Intent(Intent.ACTION_SEND_MULTIPLE).setType("image/jpeg")
        .putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(first, second)).apply {
          clipData = android.content.ClipData.newUri(context.contentResolver, "image", first)
        }
      intake.capture(intent)
      batch = intake.batches.value.single { it.id !in before }
      assertEquals(2, batch.files.size)
      val gateway = UUID.randomUUID().toString(); val conversation = UUID.randomUUID().toString()
      intake.bind(batch, gateway, "device", conversation)
      val captured = batch
      assertThrows(IllegalArgumentException::class.java) { intake.bind(captured, gateway, "other-device", conversation) }
    } finally {
      batch?.let { intake.dismiss(it.id) }
      CameraCaptureStore.discard(context, first); CameraCaptureStore.discard(context, second)
    }
  }

  @Test fun workspaceFileReferenceSurvivesDraftReloadAndSendsRelativePath() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    try {
      val file = ManagedFile("brief", "workspace", "brief.pdf", "docs/brief.pdf", "file", "application/pdf", 200)
      val attachment = store.addWorkspaceFile(gatewayId, conversationId, file)
      val restored = ChatAttachmentStore(context).list(gatewayId, conversationId).single()
      assertEquals(attachment, restored)
      val payload = store.wirePayloads(gatewayId, conversationId, listOf(restored)).getJSONObject(0)
      assertEquals("docs/brief.pdf", payload.getString("workspaceRelativePath"))
      assertEquals("document", payload.getString("type"))
      assertEquals("", payload.getString("data"))
      assertTrue(store.list(gatewayId, UUID.randomUUID().toString()).isEmpty())
      store.remove(gatewayId, conversationId, attachment.id)
      assertTrue(store.list(gatewayId, conversationId).isEmpty())
    } finally { store.removeGateway(gatewayId) }
  }

  @Test fun voiceRecordingKeepsDurationInEncryptedDraftAndWirePayload() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    try {
      val item = store.addVoiceBytes(gatewayId, conversationId, byteArrayOf(1, 2, 3), 4)
      assertEquals("voice", item.type)
      assertEquals(4, ChatAttachmentStore(context).list(gatewayId, conversationId).single().durationSeconds)
      val wire = store.wirePayloads(gatewayId, conversationId, listOf(item)).getJSONObject(0)
      assertEquals("voice", wire.getString("type"))
      assertEquals("audio/mp4", wire.getString("mimeType"))
      assertEquals(4, wire.getInt("durationSeconds"))
      assertEquals(listOf(1, 2, 3), Base64.getDecoder().decode(wire.getString("data"))
        .map { it.toInt() })
    } finally { store.removeGateway(gatewayId) }
  }

  @Test fun imagePreviewUsesEncryptedSnapshotAndConversationScope() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    val image = Bitmap.createBitmap(32, 24, Bitmap.Config.ARGB_8888)
    val bytes = ByteArrayOutputStream().also { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
      .toByteArray()
    try {
      val item = store.addBytes(gatewayId, conversationId, "photo.png", "image/png", bytes)
      val preview = ChatAttachmentStore(context).previewImage(gatewayId, conversationId, item)
      assertEquals(32, preview?.width)
      assertEquals(24, preview?.height)
      assertEquals(null, store.previewImage(gatewayId, UUID.randomUUID().toString(), item))
      store.remove(gatewayId, conversationId, item.id)
      assertEquals(null, store.previewImage(gatewayId, conversationId, item))
    } finally { store.removeGateway(gatewayId) }
  }

  @Test fun galleryContractRequestsOnlyOneImageWithoutLibraryPermission() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val intent = ActivityResultContracts.PickVisualMedia().createIntent(context,
      PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    assertEquals("image/*", intent.type)
    assertTrue(intent.action == MediaStore.ACTION_PICK_IMAGES || intent.action == Intent.ACTION_OPEN_DOCUMENT)
  }

  @Test fun cameraContractGrantsOnlyItsOutputUriTemporarily() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val uri = CameraCaptureStore.create(context)
    try {
      val intent = CameraTakePictureContract().createIntent(context, uri)
      assertEquals(MediaStore.ACTION_IMAGE_CAPTURE, intent.action)
      assertEquals(uri, intent.clipData?.getItemAt(0)?.uri)
      assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        intent.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
      assertEquals(0, intent.flags and Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
      assertEquals(0, intent.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    } finally { CameraCaptureStore.discard(context, uri) }
  }

  @Test fun selectedGalleryImageIsSnapshottedWithoutKeepingItsUriGrant() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
      ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, "xopc-photo-test-${UUID.randomUUID()}.jpg")
        put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }) ?: throw AssertionError("Test provider did not create an image")
    try {
      context.contentResolver.openOutputStream(uri)!!.use { it.write(byteArrayOf(4, 5, 6)) }
      context.contentResolver.update(uri, ContentValues().apply {
        put(MediaStore.MediaColumns.IS_PENDING, 0)
      }, null, null)
      val item = store.import(gatewayId, conversationId, uri)
      assertEquals("image", item.type)
      assertEquals("image/jpeg", item.mimeType)
      context.contentResolver.delete(uri, null, null)
      val payload = ChatAttachmentStore(context).wirePayloads(gatewayId, conversationId, listOf(item))
        .getJSONObject(0)
      assertEquals(listOf(4, 5, 6), Base64.getDecoder().decode(payload.getString("data"))
        .map { it.toInt() })
    } finally {
      runCatching { context.contentResolver.delete(uri, null, null) }
      store.removeGateway(gatewayId)
    }
  }

  @Test fun cameraOutputUsesOnlyPrivateCaptureCacheAndIsRemovedAfterSnapshot() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    val uri = CameraCaptureStore.create(context)
    try {
      assertEquals("content", uri.scheme)
      assertEquals("${context.packageName}.camera-capture", uri.authority)
      assertThrows(IllegalArgumentException::class.java) {
        FileProvider.getUriForFile(context, "${context.packageName}.camera-capture",
          File(context.cacheDir, "outside-capture.jpg"))
      }
      context.contentResolver.openOutputStream(uri)!!.use { it.write(byteArrayOf(1, 2, 3)) }
      val item = store.import(gatewayId, conversationId, uri)
      assertEquals("image", item.type)
      CameraCaptureStore.discard(context, uri)
      assertThrows(Exception::class.java) { context.contentResolver.openInputStream(uri)!!.close() }
      val wire = store.wirePayloads(gatewayId, conversationId, listOf(item)).getJSONObject(0)
      assertEquals(listOf(1, 2, 3), Base64.getDecoder().decode(wire.getString("data"))
        .map { it.toInt() })
    } finally {
      CameraCaptureStore.discard(context, uri)
      store.removeGateway(gatewayId)
    }
  }

  @Test fun quickSnapshotsMoveToNewConversationAndRemainEncryptedAndScoped() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val quickScope = "00000000-0000-0000-0000-000000000000"
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    try {
      val item = store.addBytes(gatewayId, quickScope, "handoff.txt", "text/plain",
        "retained".toByteArray())
      assertEquals(listOf(item), store.moveAll(gatewayId, quickScope, conversationId))
      assertEquals(emptyList<ChatAttachment>(), store.list(gatewayId, quickScope))
      assertEquals(listOf(item), ChatAttachmentStore(context).list(gatewayId, conversationId))
      assertEquals(listOf(item), store.moveAll(gatewayId, quickScope, conversationId))
      val wire = store.wirePayloads(gatewayId, conversationId, listOf(item)).getJSONObject(0)
      assertEquals("retained", String(Base64.getDecoder().decode(wire.getString("data"))))
      assertThrows(IllegalArgumentException::class.java) {
        store.wirePayloads(gatewayId, quickScope, listOf(item))
      }
    } finally { store.removeGateway(gatewayId) }
  }

  @Test fun encryptedSnapshotSurvivesRecreationAndIsScopedToItsConversation() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val otherConversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    try {
      val item = store.addBytes(gatewayId, conversationId, "photo.png", "image/png", byteArrayOf(1, 2, 3))
      assertEquals("image", item.type)
      assertEquals(listOf(item), ChatAttachmentStore(context).list(gatewayId, conversationId))
      assertEquals(emptyList<ChatAttachment>(), store.list(gatewayId, otherConversationId))
      val payload = ChatAttachmentStore(context).wirePayloads(gatewayId, conversationId, listOf(item))
        .getJSONObject(0)
      assertEquals(listOf(1, 2, 3), Base64.getDecoder().decode(payload.getString("data"))
        .map { it.toInt() })
      assertEquals(false, payload.has("id"))
      assertThrows(IllegalArgumentException::class.java) {
        store.wirePayloads(gatewayId, otherConversationId, listOf(item))
      }
      assertThrows(IllegalArgumentException::class.java) {
        store.import(gatewayId, conversationId, Uri.parse("file:///tmp/not-allowed"))
      }
    } finally { store.removeGateway(gatewayId) }
  }

  @Test fun rejectsEmptyOversizeAndEleventhAttachment() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    try {
      assertThrows(IllegalArgumentException::class.java) {
        store.addBytes(gatewayId, conversationId, "empty.txt", "text/plain", byteArrayOf())
      }
      assertThrows(IllegalArgumentException::class.java) {
        store.addBytes(gatewayId, conversationId, "large.txt", "text/plain",
          ByteArray(ChatAttachmentStore.MAX_BYTES + 1))
      }
      repeat(ChatAttachmentStore.MAX_ATTACHMENTS) {
        store.addBytes(gatewayId, conversationId, "small-$it.txt", "text/plain", byteArrayOf(1))
      }
      assertThrows(IllegalArgumentException::class.java) {
        store.addBytes(gatewayId, conversationId, "extra.txt", "text/plain", byteArrayOf(1))
      }
    } finally { store.removeGateway(gatewayId) }
  }

  @Test fun snapshotsActualContentProviderBytesBeforeTheSourceIsRemoved() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
      ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, "xopc-attachment-test-${UUID.randomUUID()}.txt")
        put(MediaStore.MediaColumns.MIME_TYPE, "text/plain")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }) ?: throw AssertionError("Test provider did not create a document")
    try {
      context.contentResolver.openOutputStream(uri)!!.use { it.write("snapshot".toByteArray()) }
      context.contentResolver.update(uri, ContentValues().apply {
        put(MediaStore.MediaColumns.IS_PENDING, 0)
      }, null, null)
      val item = store.import(gatewayId, conversationId, uri)
      assertEquals("text/plain", item.mimeType)
      context.contentResolver.delete(uri, null, null)
      val wire = store.wirePayloads(gatewayId, conversationId, listOf(item)).getJSONObject(0)
      assertEquals("snapshot", String(Base64.getDecoder().decode(wire.getString("data"))))
    } finally {
      context.contentResolver.delete(uri, null, null)
      store.removeGateway(gatewayId)
    }
  }
}
