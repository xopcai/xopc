package ai.xopc.mobile.gateway

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.Uri
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayOutputStream
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

data class ChatAttachment(val id: String, val type: String, val name: String,
  val mimeType: String, val size: Int)

/** Immutable, encrypted attachment snapshots scoped to one Gateway and conversation. */
class ChatAttachmentStore(context: Context) {
  private val app = context.applicationContext
  private val database = AttachmentDatabase(app)

  @Synchronized
  fun import(gatewayId: String, conversationId: String, uri: Uri): ChatAttachment {
    require(uri.scheme == "content") { "INVALID_ATTACHMENT_URI" }
    val resolver = app.contentResolver
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else null
    }?.substringAfterLast('/')?.substringAfterLast('\\')?.filter { it.code >= 32 }
      ?.take(255)?.ifBlank { null } ?: "attachment"
    val mime = resolver.getType(uri)?.takeIf { it.length <= 127 && MIME.matches(it) }
      ?: mimeFromName(name)
    val bytes = resolver.openInputStream(uri)?.use(::readBounded)
      ?: throw IllegalArgumentException("ATTACHMENT_UNAVAILABLE")
    return addBytes(gatewayId, conversationId, name, mime, bytes)
  }

  @Synchronized
  fun addBytes(gatewayId: String, conversationId: String, name: String, mimeType: String,
    bytes: ByteArray): ChatAttachment {
    checkScope(gatewayId, conversationId)
    val current = list(gatewayId, conversationId)
    require(current.size < MAX_ATTACHMENTS) { "ATTACHMENT_LIMIT_10" }
    require(bytes.isNotEmpty()) { "EMPTY_ATTACHMENT" }
    require(bytes.size <= MAX_BYTES) { "ATTACHMENT_LIMIT_10_MB" }
    require(current.sumOf { it.size } + bytes.size <= MAX_TOTAL_BYTES) { "ATTACHMENT_TOTAL_LIMIT_20_MB" }
    require(name.isNotBlank() && name.length <= 255 && name.none { it.code < 32 } &&
      mimeType.length <= 127 && MIME.matches(mimeType)) { "INVALID_ATTACHMENT_METADATA" }
    val item = ChatAttachment(UUID.randomUUID().toString(),
      if (mimeType.startsWith("image/")) "image" else "document", name, mimeType, bytes.size)
    val metadata = metadataJson(item).toString().toByteArray(Charsets.UTF_8)
    val values = ContentValues().apply {
      put("gateway_id", gatewayId); put("conversation_id", conversationId); put("attachment_id", item.id)
      put("metadata", encrypt(gatewayId, conversationId, item.id, "metadata", metadata))
      put("payload", encrypt(gatewayId, conversationId, item.id, "payload", bytes))
      put("created_at", System.currentTimeMillis())
    }
    check(database.writableDatabase.insertOrThrow(TABLE, null, values) != -1L) { "ATTACHMENT_SAVE_FAILED" }
    return item
  }

  @Synchronized
  fun list(gatewayId: String, conversationId: String): List<ChatAttachment> {
    checkScope(gatewayId, conversationId)
    database.readableDatabase.query(TABLE, arrayOf("attachment_id", "metadata"),
      "gateway_id=? AND conversation_id=?", arrayOf(gatewayId, conversationId),
      null, null, "created_at ASC, attachment_id ASC").use { rows ->
      val result = ArrayList<ChatAttachment>()
      while (rows.moveToNext()) {
        val id = rows.getString(0)
        val raw = decrypt(gatewayId, conversationId, id, "metadata", rows.getBlob(1))
        result += parseMetadata(JSONObject(raw.toString(Charsets.UTF_8))).also {
          require(it.id == id) { "MISMATCHED_ATTACHMENT" }
        }
      }
      return result
    }
  }

  @Synchronized
  fun wirePayloads(gatewayId: String, conversationId: String,
    items: List<ChatAttachment>): JSONArray {
    checkScope(gatewayId, conversationId)
    require(items.size <= MAX_ATTACHMENTS && items.map { it.id }.distinct().size == items.size) {
      "INVALID_ATTACHMENTS"
    }
    val array = JSONArray()
    items.forEach { item ->
      database.readableDatabase.query(TABLE, arrayOf("metadata", "payload"),
        "gateway_id=? AND conversation_id=? AND attachment_id=?",
        arrayOf(gatewayId, conversationId, item.id), null, null, null).use { rows ->
        require(rows.moveToFirst()) { "ATTACHMENT_UNAVAILABLE" }
        val saved = parseMetadata(JSONObject(decrypt(gatewayId, conversationId, item.id,
          "metadata", rows.getBlob(0)).toString(Charsets.UTF_8)))
        require(saved == item) { "MISMATCHED_ATTACHMENT" }
        val bytes = decrypt(gatewayId, conversationId, item.id, "payload", rows.getBlob(1))
        require(bytes.size == item.size && bytes.size in 1..MAX_BYTES) { "INVALID_ATTACHMENT_DATA" }
        array.put(JSONObject().put("type", item.type).put("name", item.name)
          .put("mimeType", item.mimeType).put("size", item.size)
          .put("data", Base64.getEncoder().encodeToString(bytes)))
      }
    }
    return array
  }

  @Synchronized
  fun remove(gatewayId: String, conversationId: String, id: String) {
    checkScope(gatewayId, conversationId); checkId(id)
    database.writableDatabase.delete(TABLE, "gateway_id=? AND conversation_id=? AND attachment_id=?",
      arrayOf(gatewayId, conversationId, id))
  }

  @Synchronized
  fun removeConversation(gatewayId: String, conversationId: String) {
    checkScope(gatewayId, conversationId)
    database.writableDatabase.delete(TABLE, "gateway_id=? AND conversation_id=?",
      arrayOf(gatewayId, conversationId))
  }

  @Synchronized
  fun removeGateway(gatewayId: String) {
    checkId(gatewayId)
    database.writableDatabase.delete(TABLE, "gateway_id=?", arrayOf(gatewayId))
  }

  private fun readBounded(stream: java.io.InputStream): ByteArray {
    val out = ByteArrayOutputStream()
    val chunk = ByteArray(8192)
    while (true) {
      val count = stream.read(chunk)
      if (count < 0) break
      require(out.size() + count <= MAX_BYTES) { "ATTACHMENT_LIMIT_10_MB" }
      out.write(chunk, 0, count)
    }
    return out.toByteArray()
  }

  private fun encrypt(gatewayId: String, conversationId: String, id: String,
    field: String, plaintext: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
    cipher.updateAAD("$gatewayId:$conversationId:$id:$field".toByteArray(Charsets.UTF_8))
    return byteArrayOf(1) + cipher.iv + cipher.doFinal(plaintext)
  }

  private fun decrypt(gatewayId: String, conversationId: String, id: String,
    field: String, record: ByteArray): ByteArray {
    require(record.size >= 29 && record[0].toInt() == 1) { "INVALID_ATTACHMENT_RECORD" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, record.copyOfRange(1, 13)))
    cipher.updateAAD("$gatewayId:$conversationId:$id:$field".toByteArray(Charsets.UTF_8))
    return cipher.doFinal(record, 13, record.size - 13)
  }

  private fun encryptionKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256).build())
    return generator.generateKey()
  }

  private fun checkScope(gatewayId: String, conversationId: String) {
    checkId(gatewayId); checkId(conversationId)
  }

  private fun checkId(id: String) = require(runCatching { UUID.fromString(id) }.isSuccess) {
    "INVALID_ATTACHMENT_SCOPE"
  }

  private class AttachmentDatabase(context: Context) : SQLiteOpenHelper(context,
    "chat-attachments-v1.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
      db.execSQL("CREATE TABLE $TABLE (gateway_id TEXT NOT NULL, conversation_id TEXT NOT NULL, " +
        "attachment_id TEXT NOT NULL, metadata BLOB NOT NULL, payload BLOB NOT NULL, " +
        "created_at INTEGER NOT NULL, PRIMARY KEY(gateway_id,conversation_id,attachment_id))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
  }

  companion object {
    const val MAX_ATTACHMENTS = 10
    const val MAX_BYTES = 10 * 1024 * 1024
    const val MAX_TOTAL_BYTES = 20 * 1024 * 1024
    private const val TABLE = "chat_attachments"
    private const val KEY_ALIAS = "xopc.chat.attachments.v1"
    private val MIME = Regex("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+")

    fun metadataJson(item: ChatAttachment): JSONObject = JSONObject().put("id", item.id)
      .put("type", item.type).put("name", item.name).put("mimeType", item.mimeType)
      .put("size", item.size)

    fun parseMetadata(value: JSONObject): ChatAttachment {
      val item = ChatAttachment(value.getString("id"), value.getString("type"),
        value.getString("name"), value.getString("mimeType"), value.getInt("size"))
      require(runCatching { UUID.fromString(item.id) }.isSuccess &&
        item.type in setOf("image", "document") && item.name.isNotBlank() &&
        item.name.length <= 255 && item.name.none { it.code < 32 } &&
        item.mimeType.length <= 127 && MIME.matches(item.mimeType) &&
        item.size in 1..MAX_BYTES) { "INVALID_ATTACHMENT_METADATA" }
      return item
    }

    private fun mimeFromName(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
      "jpg", "jpeg" -> "image/jpeg"
      "png" -> "image/png"
      "gif" -> "image/gif"
      "webp" -> "image/webp"
      "pdf" -> "application/pdf"
      "txt" -> "text/plain"
      "md" -> "text/markdown"
      "csv" -> "text/csv"
      "json" -> "application/json"
      "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      else -> "application/octet-stream"
    }
  }
}
