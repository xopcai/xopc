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
