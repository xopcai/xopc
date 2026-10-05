package ai.xopc.mobile.gateway

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GatewayLocalRemovalTest {
  @Test fun removingOneGatewayClearsOnlyItsLocalConversationAndNoteDrafts() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val first = UUID.randomUUID().toString()
    val second = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val local = AndroidSecureStore(context, "gateway_local_removal_test_v1",
      "xopc.gateway.local.removal.test.v1")
    val notes = NoteDraftStore(context)
    val repository = ConversationRepository(GatewaySession(context), pendingStore = local)
    val firstKeys = listOf("composer.$first.$conversationId", "composer-refs.$first.$conversationId",
      "pending-input.$first.$conversationId", "draft.$first.$conversationId",
      "draft-index.$first", "quick-composer.$first")
    val secondKey = "composer.$second.$conversationId"
    try {
      firstKeys.forEach { local.write(it, "local-only") }
      local.write(secondKey, "keep")
      val firstNote = notes.create(first)
      val secondNote = notes.create(second)
      repository.removeGatewayLocal(first)
      notes.removeGateway(first)
      firstKeys.forEach { assertNull(local.read(it)) }
      assertEquals("keep", local.read(secondKey))
      assertNull(notes.load(first, firstNote.id))
      assertEquals(secondNote.id, notes.load(second, secondNote.id)?.id)
    } finally {
      firstKeys.forEach(local::remove)
      local.remove(secondKey)
      notes.removeGateway(first)
      notes.removeGateway(second)
    }
  }
}
