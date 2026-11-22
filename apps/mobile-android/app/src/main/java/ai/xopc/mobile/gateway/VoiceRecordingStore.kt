package ai.xopc.mobile.gateway

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal const val VOICE_SAMPLE_RATE = 16_000
internal const val VOICE_BYTES_PER_MS = VOICE_SAMPLE_RATE * 2 / 1000
internal const val VOICE_CHUNK_BYTES = VOICE_BYTES_PER_MS * 3_000
internal const val VOICE_RECORD_LIMIT_MS = 120 * 60 * 1000
internal const val VOICE_RECORD_LIMIT_BYTES = VOICE_RECORD_LIMIT_MS * VOICE_BYTES_PER_MS

internal fun voiceWav(pcm: ByteArray, size: Int): ByteArray =
  ByteBuffer.allocate(44 + size).order(ByteOrder.LITTLE_ENDIAN).apply {
    put("RIFF".toByteArray()).putInt(36 + size).put("WAVEfmt ".toByteArray()).putInt(16)
    putShort(1).putShort(1).putInt(VOICE_SAMPLE_RATE).putInt(VOICE_SAMPLE_RATE * 2)
    putShort(2).putShort(16).put("data".toByteArray()).putInt(size).put(pcm, 0, size)
  }.array()

internal class VoiceRecordingStore(context: Context) :
  SQLiteOpenHelper(context.applicationContext, "voice-recordings.db", null, 1) {
  override fun onConfigure(db: SQLiteDatabase) {
    db.setForeignKeyConstraintsEnabled(true)
    if (db.version == 0) db.execSQL("PRAGMA auto_vacuum = FULL")
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("""
      CREATE TABLE recordings (
        gateway TEXT NOT NULL, id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
        discussion_id TEXT, note_id TEXT, original_count INTEGER NOT NULL DEFAULT 0,
        last_live_segment INTEGER NOT NULL DEFAULT -1,
        PRIMARY KEY (gateway, id)
      )
    """.trimIndent())
    db.execSQL("""
      CREATE TABLE chunks (
        gateway TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL, audio BLOB NOT NULL,
        PRIMARY KEY (gateway, id, sequence),
        FOREIGN KEY (gateway, id) REFERENCES recordings(gateway, id) ON DELETE CASCADE
      )
    """.trimIndent())
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = error("UNSUPPORTED_VOICE_STORE_VERSION")

  fun list(gateway: String): List<PendingVoiceNote> = readableDatabase.rawQuery("""
    SELECT id, recorded_at, note_id FROM recordings r
    WHERE gateway = ? AND EXISTS (SELECT 1 FROM chunks c WHERE c.gateway = r.gateway AND c.id = r.id)
    ORDER BY recorded_at DESC
  """.trimIndent(), arrayOf(gateway)).use { cursor ->
    buildList {
      while (cursor.moveToNext()) {
        val noteId = if (cursor.isNull(2)) null else cursor.getString(2)
        add(PendingVoiceNote(cursor.getString(0), cursor.getLong(1), noteId, segmented = true))
      }
    }
  }

  fun append(gateway: String, draft: PendingVoiceNote, sequence: Int, wav: ByteArray) {
    val encrypted = encrypt(gateway, draft.id, sequence, wav)
    val db = writableDatabase
    db.beginTransaction()
    try {
      if (sequence == 0) db.insertOrThrow("recordings", null, ContentValues().apply {
        put("gateway", gateway); put("id", draft.id); put("recorded_at", draft.recordedAt)
      })
      db.insertOrThrow("chunks", null, ContentValues().apply {
        put("gateway", gateway); put("id", draft.id); put("sequence", sequence); put("audio", encrypted)
      })
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun count(gateway: String, id: String): Int = readableDatabase.rawQuery(
    "SELECT COUNT(*) FROM chunks WHERE gateway = ? AND id = ?", arrayOf(gateway, id)
  ).use { it.moveToFirst(); it.getInt(0) }

  fun originalCount(gateway: String, id: String): Int = readableDatabase.rawQuery(
    "SELECT original_count FROM recordings WHERE gateway = ? AND id = ?", arrayOf(gateway, id)
  ).use { if (it.moveToFirst()) it.getInt(0) else 0 }

  fun lastLiveSegment(gateway: String, id: String): Int = readableDatabase.rawQuery(
    "SELECT last_live_segment FROM recordings WHERE gateway = ? AND id = ?", arrayOf(gateway, id)
  ).use { if (it.moveToFirst()) it.getInt(0) else -1 }

  fun markLiveSegment(gateway: String, id: String, sequence: Int) =
    update(gateway, id, ContentValues().apply { put("last_live_segment", sequence) })

  fun discussionId(gateway: String, id: String): String? = readableDatabase.rawQuery(
    "SELECT discussion_id FROM recordings WHERE gateway = ? AND id = ?", arrayOf(gateway, id)
  ).use { if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null }

  fun link(gateway: String, id: String, discussionId: String, noteId: String) =
    update(gateway, id, ContentValues().apply {
      put("discussion_id", discussionId)
      put("note_id", noteId)
    })

  fun markOriginal(gateway: String, id: String, count: Int) =
    update(gateway, id, ContentValues().apply { put("original_count", count) })

  fun delete(gateway: String, id: String) {
    writableDatabase.delete("recordings", "gateway = ? AND id = ?", arrayOf(gateway, id))
  }

  fun read(gateway: String, id: String, sequence: Int): ByteArray = readableDatabase.rawQuery(
    "SELECT audio FROM chunks WHERE gateway = ? AND id = ? AND sequence = ?", arrayOf(gateway, id, sequence.toString())
  ).use { cursor ->
    check(cursor.moveToFirst()) { "VOICE_CHUNK_MISSING" }
    val record = cursor.getBlob(0)
    val cipher = cipher(Cipher.DECRYPT_MODE, record.copyOfRange(0, IV_BYTES))
    cipher.updateAAD(aad(gateway, id, sequence))
    cipher.doFinal(record, IV_BYTES, record.size - IV_BYTES)
  }

  private fun update(gateway: String, id: String, values: ContentValues) {
    check(writableDatabase.update("recordings", values, "gateway = ? AND id = ?", arrayOf(gateway, id)) == 1)
  }

  private fun encrypt(gateway: String, id: String, sequence: Int, wav: ByteArray): ByteArray {
    val cipher = cipher(Cipher.ENCRYPT_MODE)
    cipher.updateAAD(aad(gateway, id, sequence))
    return cipher.iv + cipher.doFinal(wav)
  }

  private fun aad(gateway: String, id: String, sequence: Int) = "$gateway/$id/$sequence".toByteArray()

  private fun cipher(mode: Int, iv: ByteArray? = null) = Cipher.getInstance("AES/GCM/NoPadding").apply {
    val key = synchronized(KEY_ALIAS) {
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      (keyStore.getKey(KEY_ALIAS, null) as? SecretKey) ?: KeyGenerator
        .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
          init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        }.generateKey()
    }
    if (iv == null) init(mode, key) else init(mode, key, GCMParameterSpec(128, iv))
  }

  private companion object {
    const val KEY_ALIAS = "xopc.voice-recordings.v1"
    const val IV_BYTES = 12
  }
}
