package ai.xopc.mobile.gateway

import androidx.test.core.app.ApplicationProvider
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class NoteDraftStoreTest {
  @Test fun encryptedDraftSurvivesStoreRecreationAndKeepsMutationId() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val first = NoteDraftStore(context)
    val draft = first.create(gatewayId)
    first.save(gatewayId, draft.copy(title = "Idea", markdown = "Private body", version = 2))
    val second = first.create(gatewayId)
    assertNotEquals(draft.id, second.id)
    val restored = NoteDraftStore(context).load(gatewayId, draft.id)!!
    assertEquals("Idea", restored.title)
    assertEquals("Private body", restored.markdown)
    assertEquals(draft.mutationId, restored.mutationId)
    assertEquals(setOf(draft.id, second.id), NoteDraftStore(context).pending(gatewayId).map { it.id }.toSet())
    val database = context.openOrCreateDatabase("note-drafts-v2.db", Context.MODE_PRIVATE, null)
    database.rawQuery("SELECT payload FROM note_drafts WHERE gateway_id=? AND note_id=?",
      arrayOf(gatewayId, draft.id)).use { rows ->
      assertTrue(rows.moveToFirst())
      assertEquals(false, rows.getBlob(0).toString(Charsets.UTF_8).contains("Private body"))
    }
    database.close()
    first.remove(gatewayId, draft.id)
    assertNull(NoteDraftStore(context).load(gatewayId, draft.id))
    first.remove(gatewayId, second.id)
  }

  @Test fun oversizeDraftIsNotPersisted() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val store = NoteDraftStore(context)
    val gatewayId = UUID.randomUUID().toString()
    val draft = store.create(gatewayId)
    store.save(gatewayId, draft.copy(markdown = "x".repeat(1_500_000), version = 2))
    assertEquals(1_500_000, NoteDraftStore(context).load(gatewayId, draft.id)?.markdown?.length)
    assertThrows(IllegalArgumentException::class.java) {
      store.save(gatewayId, draft.copy(markdown = "x".repeat(2_000_001)))
    }
    assertEquals(1_500_000, store.load(gatewayId, draft.id)?.markdown?.length)
    store.remove(gatewayId, draft.id)
  }

  @Test fun v1DraftMigratesOnceWithoutLosingTheOriginalMutationKey() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val draftId = "local-${UUID.randomUUID()}"
    val mutationId = UUID.randomUUID().toString()
    val legacy = AndroidSecureStore(context, "note_drafts_v1", "xopc.note.drafts.v1")
    legacy.write("note-draft.$gatewayId", org.json.JSONObject().put("id", draftId)
      .put("title", "Old draft").put("markdown", "Body").put("mutationId", mutationId)
      .put("version", 3).toString())
    val migrated = NoteDraftStore(context).pending(gatewayId).single()
    assertEquals(draftId, migrated.id)
    assertEquals(mutationId, migrated.mutationId)
    assertNull(legacy.read("note-draft.$gatewayId"))
    assertEquals(1, NoteDraftStore(context).pending(gatewayId).size)
    NoteDraftStore(context).remove(gatewayId, draftId)
  }

  @Test fun remoteEditKeepsItsBaseRevisionAcrossStoreRecreation() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val draft = NoteDraft("note-existing", "Local title", "Local body", UUID.randomUUID().toString(),
      7, 42)
    NoteDraftStore(context).save(gatewayId, draft)
    assertEquals(42L, NoteDraftStore(context).load(gatewayId, draft.id)?.baseRemoteVersion)
    NoteDraftStore(context).remove(gatewayId, draft.id)
  }

  @Test fun localDraftPromotionReplacesItsIdWithoutLosingNewerText() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val store = NoteDraftStore(context)
    val local = store.create(gatewayId).copy(title = "Newer", markdown = "Still editing", version = 4)
    store.save(gatewayId, local)
    val promoted = local.copy(id = "note-promoted", baseRemoteVersion = 2)
    store.replaceAfterSave(gatewayId, local.id, promoted)
    assertNull(NoteDraftStore(context).load(gatewayId, local.id))
    assertEquals(promoted, NoteDraftStore(context).load(gatewayId, promoted.id))
    store.replaceAfterSave(gatewayId, promoted.id, null)
    assertNull(store.load(gatewayId, promoted.id))
  }

  @Test fun invalidPromotionLeavesTheOriginalEncryptedDraftIntact() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val gatewayId = UUID.randomUUID().toString()
    val store = NoteDraftStore(context)
    val local = store.create(gatewayId).copy(markdown = "Unsynced", version = 2)
    store.save(gatewayId, local)
    assertThrows(IllegalArgumentException::class.java) {
      store.replaceAfterSave(gatewayId, local.id, local.copy(title = "x".repeat(1_001)))
    }
    assertEquals("Unsynced", store.load(gatewayId, local.id)?.markdown)
    store.remove(gatewayId, local.id)
  }
}
