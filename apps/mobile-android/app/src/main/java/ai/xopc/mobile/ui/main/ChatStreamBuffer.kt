package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConversationMessage
import ai.xopc.mobile.gateway.ConversationNarration

data class AssistantRunProgress(
  val runId: String? = null,
  val stages: List<ConversationNarration> = emptyList(),
  val status: String? = null,
) {
  fun forRun(id: String): AssistantRunProgress = if (id == runId) this else AssistantRunProgress(id)

  fun record(id: String, text: String): AssistantRunProgress {
    val publicText = text.replace(Regex("\\s+"), " ").trim().take(160)
    if (publicText.isBlank() || stages.any { it.id == id }) return this
    return copy(stages = stages + ConversationNarration(id, publicText))
  }

  fun restore(messages: List<ConversationMessage>): AssistantRunProgress {
    if (runId == null) return this
    val saved = messages.filter { it.turnId == runId }.flatMap { it.narrations }
    return copy(stages = (saved + stages).distinctBy { it.id })
  }

  val terminalStatus: String? get() = status?.takeIf { it in setOf("error", "cancelled", "suspended") }

  fun visibleStages(answerStarted: Boolean): List<ConversationNarration> =
    if (status in setOf("success", "completed") || (answerStarted && terminalStatus == null)) emptyList() else stages
}

/** Received offsets remain authoritative while UI publications are coalesced. */
internal class ChatStreamBuffer {
  private class Pending(val base: ConversationMessage) { val text = StringBuilder(base.text) }
  private val pending = linkedMapOf<String, Pending>()

  fun append(id: String, runId: String, visible: List<ConversationMessage>, delta: String,
    offset: Int?): Boolean {
    val previous = pending[id] ?: Pending(visible.firstOrNull { it.id == id } ?: ConversationMessage(id, "assistant", "", runId, answerConfirmed = false))
    val text = previous.text
    val received = offset ?: text.length
    if (received < 0 || received > text.length) return false
    val overlap = minOf(text.length - received, delta.length)
    if (overlap > 0 && text.substring(received, received + overlap) != delta.take(overlap)) return false
    val remainder = delta.drop(overlap)
    if (remainder.isNotEmpty()) { text.append(remainder); pending[id] = previous }
    return true
  }

  fun drain(visible: List<ConversationMessage>): List<ConversationMessage> {
    if (pending.isEmpty()) return visible
    val updates = pending.mapValues { (_, pending) -> pending.base.copy(text = pending.text.toString()) }
    pending.clear()
    val retained = visible.map { updates[it.id] ?: it }
    val ids = retained.mapTo(hashSetOf()) { it.id }
    return retained + updates.values.filter { it.id !in ids }
  }

  fun clear() { pending.clear() }
}

internal fun chatPresentationMessages(history: List<ConversationMessage>, live: List<ConversationMessage>): List<ConversationMessage> {
  val saved = history.flatMapTo(hashSetOf()) { it.sourceIds }
  val rows = history.filter { it.role != "assistant" || it.text.isNotBlank() || it.media.isNotEmpty() ||
    it.references.isNotEmpty() || it.targets.isNotEmpty() || it.outcome != null }.toMutableList()
  live.filter { it.answerConfirmed }.filterNot { it.id in saved }.forEach { part ->
    val previous = rows.lastOrNull()
    if (previous?.role == "assistant" && part.turnId != null && part.turnId == previous.turnId) {
      rows[rows.lastIndex] = previous.copy(id = part.id, renderId = previous.renderId,
        text = listOf(previous.text, part.text).filter(String::isNotBlank).joinToString("\n"),
        sourceIds = previous.sourceIds + part.sourceIds)
    } else rows += part
  }
  return rows
}
