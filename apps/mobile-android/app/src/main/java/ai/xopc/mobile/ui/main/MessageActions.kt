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

private val messageProductKinds = setOf("session", "note", "task", "project", "automation", "file", "user_assertion", "progress")
private val messageSettingsSections = setOf("", "language", "appearance", "notifications", "about")

private fun messageQuery(uri: URI): Map<String, String> {
  val raw = uri.rawQuery
  if (raw.isNullOrEmpty()) return emptyMap()
  return raw.split('&').filter(String::isNotEmpty).associate { part ->
    val pieces = part.split('=', limit = 2)
    URLDecoder.decode(pieces[0], "UTF-8") to URLDecoder.decode(pieces.getOrElse(1) { "" }, "UTF-8")
  }
}

private fun messageTarget(kind: String, id: String): ConversationTarget? {
  if (kind == "settings") {
    if (id !in messageSettingsSections) return null
  } else if (id.isBlank() || id in setOf(".", "..") || id.any { it.isISOControl() || it == '/' || it == '\\' }) {
    return null
  }
  return ConversationTarget(kind, id, id, capabilities = listOf("open"))
}

/** Accept only bounded in-product routes emitted by the Gateway contract. */
internal fun messageLinkTarget(raw: String): ConversationTarget? = runCatching {
  val value = raw.trim().replace("&amp;", "&")
  if (value.any { it.isISOControl() } || '\\' in value || value.length > 4_096) return null
  val uri = URI(value.removePrefix("#"))
  if (uri.userInfo != null || uri.port != -1) return null
  val path = uri.path.orEmpty()
  if (uri.scheme == "xopc") {
    return when (uri.host) {
      "workspace" -> if (path == "/file") workspaceMessageTarget(messageQuery(uri)["path"]) else null
      "open" -> if (path.isEmpty() || path == "/") {
        val query = messageQuery(uri)
        val kind = query["kind"].orEmpty()
        if (kind == "settings") {
          messageTarget("settings", query["id"].orEmpty())
        } else if (kind in messageProductKinds) {
          val id = query["id"] ?: query["key"]?.takeIf { kind == "session" }
          id?.let { messageTarget(kind, it) }
        } else null
      } else null
      "settings" -> messageTarget("settings", path.removePrefix("/"))
      "capabilities" -> if (path == "/mcp") mcpMessageTarget(messageQuery(uri)) else null
      else -> null
    }
  }
  if (uri.scheme == "xopc-file") {
    val rawId = value.removePrefix("xopc-file:")
    if ('?' in rawId || '#' in rawId) return null
    return messageTarget("file", uri.schemeSpecificPart.orEmpty())
  }
  if (uri.scheme != null || !value.removePrefix("#").startsWith("/") || uri.rawAuthority != null ||
    value.removePrefix("#").startsWith("//")) return null
  if (path == "/xopc/workspace/file") return workspaceMessageTarget(messageQuery(uri)["path"])
  val segments = path.removePrefix("/").split('/')
  val id = segments.getOrNull(1).orEmpty()
  if (segments.size > 2) return null
  when (segments.first()) {
    "tasks" -> messageTarget("task", id)
    "projects" -> messageTarget("project", id)
    "notes" -> messageTarget("note", id)
    "chat", "sessions" -> messageTarget("session", id)
    "files" -> messageTarget("file", id)
    "automations" -> {
      val query = messageQuery(uri)
      when {
        id.isNotEmpty() -> messageTarget("automation", id)
        "run" in query -> messageTarget("automation-run", query.getValue("run"))
        else -> messageTarget("automation", query["automation"].orEmpty())
      }
    }
    "settings" -> messageTarget("settings", id)
    else -> null
  }
}.getOrNull()

private fun mcpMessageTarget(query: Map<String, String>): ConversationTarget? {
  val name = query["id"]?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,64}")) } ?: return null
  val address = query["url"]?.takeIf { it.length <= 2048 } ?: return null
  val uri = URI(address)
  if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null ||
    uri.rawQuery != null || uri.rawFragment != null) return null
  return ConversationTarget("mcp-setup", name, name, summary = address, capabilities = listOf("open"))
}

private fun workspaceMessageTarget(relative: String?): ConversationTarget? {
  if (relative.isNullOrBlank() || relative.startsWith("/") || relative.endsWith("/") ||
    relative.any { it.isISOControl() || it == '\\' } ||
    relative.split('/').any { it.isEmpty() || it == "." || it == ".." }) return null
  return ConversationTarget("workspace_file", relative, relative.substringAfterLast('/'), capabilities = listOf("open"))
}

internal fun externalMessageLink(raw: String): Boolean = runCatching {
  val uri = URI(raw)
  uri.scheme?.lowercase() in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null &&
    raw.none { it.code < 0x20 || it == '\\' }
}.getOrDefault(false)
