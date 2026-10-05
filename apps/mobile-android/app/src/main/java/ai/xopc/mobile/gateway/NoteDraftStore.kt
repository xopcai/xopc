package ai.xopc.mobile.gateway

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

data class NoteDraft(val id: String, val title: String, val markdown: String,
  val mutationId: String, val version: Long, val baseRemoteVersion: Long = 0)

/** Gateway-scoped encrypted SQLite drafts; only opaque IDs and update times are indexed in cleartext. */
class NoteDraftStore(context: Context) {
  private val database = DraftDatabase(context.applicationContext)
  private val legacy = AndroidSecureStore(context, "note_drafts_v1", "xopc.note.drafts.v1")

  @Synchronized
  fun pending(gatewayId: String): List<NoteDraft> {
    migrate(gatewayId)
    database.readableDatabase.query(TABLE, arrayOf("note_id", "payload"), "gateway_id=?",
      arrayOf(gatewayId), null, null, "updated_at DESC").use { rows ->
      val drafts = ArrayList<NoteDraft>()
      while (rows.moveToNext()) drafts += decode(gatewayId, rows.getString(0), rows.getBlob(1))
      return drafts
    }
  }

  @Synchronized
  fun load(gatewayId: String, id: String): NoteDraft? {
    migrate(gatewayId)
    database.readableDatabase.query(TABLE, arrayOf("payload"), "gateway_id=? AND note_id=?",
      arrayOf(gatewayId, id), null, null, null).use { rows ->
      return if (rows.moveToFirst()) decode(gatewayId, id, rows.getBlob(0)) else null
    }
  }

  @Synchronized
  fun create(gatewayId: String): NoteDraft = NoteDraft("local-${UUID.randomUUID()}", "", "",
    UUID.randomUUID().toString(), 1).also { save(gatewayId, it) }

  @Synchronized
  fun save(gatewayId: String, draft: NoteDraft) {
    checkGatewayId(gatewayId)
    check(database.writableDatabase.insertWithOnConflict(TABLE, null, values(gatewayId, draft),
      SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "NOTE_DRAFT_WRITE_FAILED" }
  }

  /** Atomically promotes a local ID or removes an acknowledged clean draft. */
  @Synchronized
  fun replaceAfterSave(gatewayId: String, oldId: String, remaining: NoteDraft?) {
    checkGatewayId(gatewayId)
    require(oldId.matches(ID_PATTERN)) { "INVALID_NOTE_ID" }
    val nextValues = remaining?.let { values(gatewayId, it) }
    val db = database.writableDatabase
    db.beginTransactionNonExclusive()
    try {
      db.delete(TABLE, "gateway_id=? AND note_id=?", arrayOf(gatewayId, oldId))
      if (nextValues != null) check(db.insertWithOnConflict(TABLE, null, nextValues,
        SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "NOTE_DRAFT_WRITE_FAILED" }
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }

  @Synchronized
  fun remove(gatewayId: String, id: String) {
    checkGatewayId(gatewayId)
    require(id.matches(ID_PATTERN)) { "INVALID_NOTE_ID" }
    database.writableDatabase.delete(TABLE, "gateway_id=? AND note_id=?", arrayOf(gatewayId, id))
  }

  @Synchronized
  fun removeGateway(gatewayId: String) {
    checkGatewayId(gatewayId)
    database.writableDatabase.delete(TABLE, "gateway_id=?", arrayOf(gatewayId))
    legacy.remove("note-draft.$gatewayId")
  }

  private fun migrate(gatewayId: String) {
    checkGatewayId(gatewayId)
    val key = "note-draft.$gatewayId"
    val raw = legacy.read(key) ?: return
    val draft = JSONObject(raw).let { row -> NoteDraft(row.getString("id"), row.getString("title"),
      row.getString("markdown"), row.getString("mutationId"), row.getLong("version")) }
    validate(draft)
    if (loadWithoutMigration(gatewayId, draft.id) == null) save(gatewayId, draft)
    legacy.remove(key)
  }

  private fun values(gatewayId: String, draft: NoteDraft): ContentValues {
    validate(draft)
    val json = JSONObject().put("id", draft.id).put("title", draft.title)
      .put("markdown", draft.markdown).put("mutationId", draft.mutationId)
      .put("version", draft.version).put("baseRemoteVersion", draft.baseRemoteVersion).toString()
    return ContentValues().apply {
      put("gateway_id", gatewayId)
      put("note_id", draft.id)
      put("payload", encrypt(gatewayId, draft.id, json.toByteArray(Charsets.UTF_8)))
      put("updated_at", System.currentTimeMillis())
    }
  }

  private fun loadWithoutMigration(gatewayId: String, id: String): NoteDraft? {
    database.readableDatabase.query(TABLE, arrayOf("payload"), "gateway_id=? AND note_id=?",
      arrayOf(gatewayId, id), null, null, null).use { rows ->
      return if (rows.moveToFirst()) decode(gatewayId, id, rows.getBlob(0)) else null
    }
  }

  private fun decode(gatewayId: String, id: String, payload: ByteArray): NoteDraft {
    val row = JSONObject(decrypt(gatewayId, id, payload).toString(Charsets.UTF_8))
    return NoteDraft(row.getString("id"), row.getString("title"), row.getString("markdown"),
      row.getString("mutationId"), row.getLong("version"), row.optLong("baseRemoteVersion", 0)).also {
      validate(it)
      require(it.id == id) { "MISMATCHED_NOTE_DRAFT" }
    }
  }

  private fun encrypt(gatewayId: String, id: String, plaintext: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
    cipher.updateAAD("$gatewayId:$id".toByteArray(Charsets.UTF_8))
    return byteArrayOf(1) + cipher.iv + cipher.doFinal(plaintext)
  }

  private fun decrypt(gatewayId: String, id: String, payload: ByteArray): ByteArray {
    require(payload.size >= 29 && payload[0].toInt() == 1) { "INVALID_NOTE_DRAFT_RECORD" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), GCMParameterSpec(128, payload.copyOfRange(1, 13)))
    cipher.updateAAD("$gatewayId:$id".toByteArray(Charsets.UTF_8))
    return cipher.doFinal(payload, 13, payload.size - 13)
  }

  private fun encryptionKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256).build())
    return generator.generateKey()
  }

  private fun checkGatewayId(id: String) = require(id.matches(GATEWAY_PATTERN)) { "INVALID_GATEWAY_ID" }

  private fun validate(draft: NoteDraft) {
    require(draft.id.matches(ID_PATTERN) && draft.mutationId.matches(GATEWAY_PATTERN) &&
      draft.version > 0 && draft.baseRemoteVersion >= 0 && draft.title.length <= 1000 &&
      draft.markdown.length <= 2_000_000 &&
      draft.markdown.toByteArray(Charsets.UTF_8).size <= 4_500_000) { "INVALID_NOTE_DRAFT" }
  }

  private class DraftDatabase(context: Context) : SQLiteOpenHelper(context, "note-drafts-v2.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
      db.execSQL("CREATE TABLE $TABLE (gateway_id TEXT NOT NULL, note_id TEXT NOT NULL, " +
        "payload BLOB NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(gateway_id,note_id))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
  }

  private companion object {
    const val TABLE = "note_drafts"
    const val KEY_ALIAS = "xopc.note.drafts.v2"
    val GATEWAY_PATTERN = Regex("[0-9a-fA-F-]{36}")
    val ID_PATTERN = Regex("[A-Za-z0-9_-]{1,128}")
  }
}
