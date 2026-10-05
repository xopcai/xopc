package ai.xopc.mobile.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NoteRepositoryTest {
  private val item = """{"id":"note-1","title":"Idea","kind":"thought","status":"inbox",
    "createdAt":1000,"updatedAt":2000,"pinned":true,"tags":["mobile"],"snippet":"A short idea"}"""

  @Test fun listParsesGatewayProjectionAndPagination() {
    val page = NoteRepository.parseList("""{"items":[$item],"total":2,"hasMore":true}""", 0)
    assertEquals(2, page.total)
    assertEquals(true, page.hasMore)
    assertEquals("note-1", page.items.single().id)
    assertEquals("A short idea", page.items.single().snippet)
    assertEquals(true, page.items.single().pinned)
    assertEquals(listOf("mobile"), page.items.single().tags)
  }

  @Test fun detailChecksIdentityAndContent() {
    val raw = """{"note":{"id":"note-1","title":"Idea","kind":"thought","status":"inbox",
      "createdAt":1000,"updatedAt":2000,"markdown":"# Idea\\nBody","remoteVersion":3}}"""
    assertEquals(3L, NoteRepository.parseDetail("note-1", raw).remoteVersion)
    assertThrows(IllegalArgumentException::class.java) { NoteRepository.parseDetail("note-2", raw) }
    assertThrows(IllegalArgumentException::class.java) {
      NoteRepository.parseList("""{"items":[],"total":3,"hasMore":true}""", 0)
    }
  }

  @Test fun saveReconciliationPreservesNewKeystrokesAndRebasesTheDraft() {
    val sent = NoteDraft("local-00000000-0000-0000-0000-000000000001", "Old", "Old body",
      "00000000-0000-0000-0000-000000000002", 3)
    val current = sent.copy(title = "New", markdown = "New body", version = 4)
    val remote = NoteDetail("note-created", "Old", "Old body", "inbox", "thought", 2000L,
      false, emptyList(), 2L)
    val newer = reconcileNoteSave(sent, current, remote, "00000000-0000-0000-0000-000000000003")
    assertEquals(true, newer.needsSync)
    assertEquals("New body", newer.draft.markdown)
    assertEquals("note-created", newer.draft.id)
    assertEquals(2L, newer.draft.baseRemoteVersion)
    val clean = reconcileNoteSave(sent, sent, remote, "00000000-0000-0000-0000-000000000004")
    assertEquals(false, clean.needsSync)
    assertEquals("Old body", clean.draft.markdown)
  }

  @Test fun historyAndSnapshotValidateGatewayEnvelopeAndIdentity() {
    val entries = NoteRepository.parseHistory("""{"entries":[{"timestamp":1234,
      "trigger":"sync","snippet":"Old body"}]}""")
    assertEquals(1234L, entries.single().timestamp)
    val raw = """{"snapshot":{"noteId":"note-1","timestamp":1234,"trigger":"sync",
      "title":"Earlier","markdown":"Old body","kind":"thought","status":"inbox"}}"""
    assertEquals("Old body", NoteRepository.parseSnapshot("note-1", 1234L, raw).markdown)
    assertThrows(IllegalArgumentException::class.java) {
      NoteRepository.parseSnapshot("note-2", 1234L, raw)
    }
    assertThrows(IllegalArgumentException::class.java) {
      NoteRepository.parseSnapshot("note-1", 1235L, raw)
    }
  }

  @Test fun deleteRequiresAnExplicitConfirmedBoolean() {
    assertEquals(true, NoteRepository.parseDeleteResponse("""{"deleted":true,"revokedShares":0}"""))
    assertEquals(false, NoteRepository.parseDeleteResponse("""{"deleted":false}"""))
    assertEquals(false, NoteRepository.parseDeleteResponse("""{"deleted":"true"}"""))
  }

  @Test fun shareRequiresConfirmedBoundedHttpUrlAndNoteKind() {
    val note = NoteDetail("note-1", "Idea", "Body", "inbox", "thought", 2000L,
      false, emptyList(), 3L)
    val valid = """{"ok":true,"payload":{"id":"share-1","kind":"note",
      "shareUrl":"https://share.example/s/token","reachability":"lan",
      "expiresAt":"2026-10-05T00:00:00Z"}}"""
    assertEquals("lan", NoteRepository.parseShare(valid, note).reachability)
    assertThrows(IllegalArgumentException::class.java) {
      NoteRepository.parseShare(valid.replace("\"ok\":true", "\"ok\":false"), note)
    }
    assertThrows(IllegalArgumentException::class.java) {
      NoteRepository.parseShare(valid.replace("https://share.example", "javascript:alert(1)"), note)
    }
    assertThrows(IllegalArgumentException::class.java) {
      NoteRepository.parseShare(valid.replace("\"kind\":\"note\"", "\"kind\":\"file\""), note)
    }
  }
}
