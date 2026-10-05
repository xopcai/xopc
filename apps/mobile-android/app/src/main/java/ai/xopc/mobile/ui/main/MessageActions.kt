package ai.xopc.mobile.ui.main

private val CODE_FENCE = Regex("```[A-Za-z0-9_-]*\\r?\\n?([\\s\\S]*?)```")

/** Text copied by the Assistant's Copy code action. */
internal fun extractMarkdownCodeBlocks(text: String): String = CODE_FENCE.findAll(text)
  .map { it.groupValues[1].trim() }
  .filter { it.isNotEmpty() }
  .joinToString("\n\n")
