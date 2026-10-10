package ai.xopc.mobile.ui.main

internal data class ChatReplySpace(val budget: Float = 0f, val remaining: Float = 0f) {
  fun begin(availableHeight: Float, following: Boolean): ChatReplySpace {
    if (!following) return this
    val space = minOf(64f, availableHeight.coerceAtLeast(0f) * 0.1f)
    return ChatReplySpace(space, space)
  }

  fun consume(replyHeight: Float, availableHeight: Float, following: Boolean): ChatReplySpace {
    if (!following) return this
    val space = minOf(remaining, minOf(budget, minOf(64f, availableHeight.coerceAtLeast(0f) * 0.1f)) -
      replyHeight.coerceAtLeast(0f)).coerceAtLeast(0f)
    return copy(remaining = space)
  }
}
