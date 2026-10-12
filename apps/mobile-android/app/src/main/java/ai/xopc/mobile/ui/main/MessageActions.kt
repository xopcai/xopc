package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ConversationTarget
import java.net.URI
import java.net.URLDecoder

private val CODE_FENCE = Regex("```[A-Za-z0-9_-]*\\r?\\n?([\\s\\S]*?)```")

/** Text copied by the Assistant's Copy code action. */
internal fun extractMarkdownCodeBlocks(text: String): String = CODE_FENCE.findAll(text)
  .map { it.groupValues[1].trim() }
  .filter { it.isNotEmpty() }
  .joinToString("\n\n")

private val MARKDOWN_LINK = Regex("\\[([^]\\n]{1,240})]\\(([^)\\s]{1,4096})\\)")

internal data class MessageMarkdownLink(val label: String, val url: String)

internal fun extractMessageMarkdownLinks(text: String): List<MessageMarkdownLink> = MARKDOWN_LINK.findAll(text)
  .map { MessageMarkdownLink(it.groupValues[1], it.groupValues[2]) }
  .distinctBy { it.url }
  .take(20)
  .toList()

internal fun plainMessageMarkdown(text: String): String = text
  .replace(CODE_FENCE) { it.groupValues[1].trim() }
  .replace(MARKDOWN_LINK) { it.groupValues[1] }

internal const val USER_MESSAGE_PREVIEW_LINES = 4
internal const val ASSISTANT_MESSAGE_PREVIEW_LINES = 8

internal fun messagePreviewLineLimit(role: String): Int =
  if (role == "user") USER_MESSAGE_PREVIEW_LINES else ASSISTANT_MESSAGE_PREVIEW_LINES

/** Matches the HarmonyOS compact-history rule while keeping the latest message fully expanded. */
internal fun messageNeedsPreview(role: String, text: String): Boolean {
  val limit = messagePreviewLineLimit(role)
  var lines = 0
  plainMessageMarkdown(text).lineSequence().forEach { rawLine ->
    val line = rawLine.trim().removePrefix("### ").removePrefix("## ").removePrefix("# ")
    if (line.isBlank()) return@forEach
    var units = 0.0
    line.forEach { units += if (it.code > 255) 1.0 else 0.55 }
    lines += maxOf(1, kotlin.math.ceil(units / 15.0).toInt())
    if (lines > limit) return true
  }
  return false
}

/** Accept only bounded in-product routes emitted by the Gateway contract. */
internal fun messageLinkTarget(raw: String): ConversationTarget? {
  val value = raw.trim()
  if (value.any { it.code < 0x20 } || '\\' in value || value.length > 4_096) return null
  val path = when {
    value.startsWith("xopc://workspace/file?") || value.startsWith("/xopc/workspace/file?") -> runCatching {
      val query = URI(value).rawQuery.orEmpty().split('&').associate { part ->
        val pieces = part.split('=', limit = 2)
        URLDecoder.decode(pieces[0], "UTF-8") to URLDecoder.decode(pieces.getOrElse(1) { "" }, "UTF-8")
      }
      val relative = query["path"].orEmpty()
      if (relative.isBlank() || relative.any { it.code < 0x20 } || '\\' in relative || relative.split('/').any { it == ".." }) return null
      return ConversationTarget("workspace_file", relative, relative.substringAfterLast('/'), capabilities = listOf("open"))
    }.getOrNull() ?: return null
    value.startsWith("xopc-file:") -> return value.removePrefix("xopc-file:").takeIf(String::isNotBlank)?.let {
      ConversationTarget("file", it, it, capabilities = listOf("open"))
    }
    value.startsWith("xopc://open?") -> runCatching {
      val query = URI(value).rawQuery.orEmpty().split('&').associate { part ->
        val pieces = part.split('=', limit = 2)
        URLDecoder.decode(pieces[0], "UTF-8") to URLDecoder.decode(pieces.getOrElse(1) { "" }, "UTF-8")
      }
      val kind = query["kind"].orEmpty()
      val id = query["id"].orEmpty()
      if (kind.isBlank() || id.isBlank()) return null
      return ConversationTarget(kind, id, id, capabilities = listOf("open"))
    }.getOrNull() ?: return null
    value.startsWith("#/") -> value.removePrefix("#")
    value.startsWith("/") -> value
    else -> return null
  }
  if (path.split('/').any { it == "." || it == ".." }) return null
  val segments = path.substringBefore('?').trim('/').split('/').filter(String::isNotBlank)
  if (segments.isEmpty()) return null
  fun decoded(index: Int): String? = segments.getOrNull(index)?.let {
    runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull()?.takeIf(String::isNotBlank)
  }
  val target = when (segments[0]) {
    "tasks" -> decoded(1)?.let { ConversationTarget("task", it, it, capabilities = listOf("open")) }
    "projects" -> decoded(1)?.let { ConversationTarget("project", it, it, capabilities = listOf("open")) }
    "notes" -> decoded(1)?.let { ConversationTarget("note", it, it, capabilities = listOf("open")) }
    "chat" -> decoded(1)?.let { ConversationTarget("session", it, it, capabilities = listOf("open")) }
    "sessions" -> decoded(1)?.let { ConversationTarget("session", it, it, capabilities = listOf("open")) }
    "files" -> decoded(1)?.let { ConversationTarget("file", it, it, capabilities = listOf("open")) }
    "workflows" -> if (segments.getOrNull(1) == "runs") decoded(2)?.let {
      ConversationTarget("workflow_run", it, it, capabilities = listOf("open"))
    } else decoded(1)?.let { ConversationTarget("workflow_definition", it, it, capabilities = listOf("open")) }
    "automations" -> decoded(1)?.let { ConversationTarget("automation", it, it, capabilities = listOf("open")) }
      ?: runCatching { URI(value.removePrefix("#")).rawQuery?.split('&')?.firstNotNullOfOrNull { part ->
      part.split('=', limit = 2).takeIf { it.firstOrNull() == "automation" }?.getOrNull(1)
        ?.let { URLDecoder.decode(it, "UTF-8") }
    }?.takeIf(String::isNotBlank)?.let { ConversationTarget("automation", it, it, capabilities = listOf("open")) } }.getOrNull()
    "settings" -> segments.drop(1).joinToString("/").takeIf(String::isNotBlank)?.let {
      ConversationTarget("settings", it, it, capabilities = listOf("open"))
    }
    else -> null
  }
  return target
}

internal fun externalMessageLink(raw: String): Boolean = runCatching {
  val uri = URI(raw)
  uri.scheme?.lowercase() in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null &&
    raw.none { it.code < 0x20 || it == '\\' }
}.getOrDefault(false)
