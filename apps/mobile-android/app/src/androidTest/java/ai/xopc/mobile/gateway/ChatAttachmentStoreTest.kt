package ai.xopc.mobile.gateway

import android.net.Uri
import android.content.ContentValues
import android.provider.MediaStore
import androidx.test.core.app.ApplicationProvider
import android.content.Context
import java.util.Base64
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ChatAttachmentStoreTest {
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
