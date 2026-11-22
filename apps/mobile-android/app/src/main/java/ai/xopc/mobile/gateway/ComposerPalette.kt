package ai.xopc.mobile.gateway

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runInterruptible
import org.json.JSONArray
import org.json.JSONObject

internal data class ComposerPaletteItem(
  val id: String,
  val title: String,
  val description: String = "",
  val insertion: String,
  val skill: Boolean,
  val aliases: List<String> = emptyList(),
) {
  private val bareId: String
    get() = id.removePrefix("skill:").removePrefix("command:")

  fun rank(query: String): Int {
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return 0
    val lowerTitle = title.lowercase()
    val lowerId = bareId.lowercase()
    val lowerAliases = aliases.map(String::lowercase)
    if (lowerTitle == needle || lowerId == needle) return 0
    if (needle in lowerAliases) return 1
    if (lowerTitle.startsWith(needle) || lowerId.startsWith(needle)) return 2
    if (lowerAliases.any { it.startsWith(needle) }) return 3
    if (lowerTitle.contains(needle) || lowerId.contains(needle)) return 4
    if (lowerAliases.any { it.contains(needle) }) return 5
    return if (description.lowercase().contains(needle)) 100 else -1
  }
}

private fun humanizedSkillName(name: String): String =
  name.split('-', '_').filter(String::isNotBlank).joinToString(" ") { part ->
    part.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
  }.ifBlank { name }

internal suspend fun GatewaySession.composerPaletteAsync(gatewayId: String, locale: String): List<ComposerPaletteItem> =
  coroutineScope {
    val commandsDeferred = async(Dispatchers.IO) {
      runInterruptible { request("/api/commands", expectedGatewayId = gatewayId) }
    }
    val skillsDeferred = async(Dispatchers.IO) {
      runInterruptible { request("/api/skills", expectedGatewayId = gatewayId) }
    }
    parseComposerPalette(commandsDeferred.await(), skillsDeferred.await(), locale)
  }

internal fun GatewaySession.composerPalette(gatewayId: String, locale: String): List<ComposerPaletteItem> =
  parseComposerPalette(
    request("/api/commands", expectedGatewayId = gatewayId),
    request("/api/skills", expectedGatewayId = gatewayId),
    locale,
  )

internal fun parseComposerPalette(commandsRaw: String, skillsRaw: String, locale: String): List<ComposerPaletteItem> {
  val commands = JSONObject(commandsRaw).optJSONObject("payload")?.optJSONArray("commands") ?: JSONArray()
  val skills = JSONObject(skillsRaw).optJSONObject("payload")?.optJSONArray("catalog") ?: JSONArray()
  val localeKey = if (locale.startsWith("zh")) "zh-CN" else "en"
  return skills.objects().mapNotNull { skill ->
    val name = skill.optString("name").takeIf(String::isNotBlank) ?: return@mapNotNull null
    if (!skill.optBoolean("enabled")) return@mapNotNull null
    val translations = skill.optJSONObject("localizations")
    val localized = translations?.optJSONObject(localeKey) ?: translations?.optJSONObject("en")
    val title = localized?.optString("displayName").orEmpty().ifBlank { humanizedSkillName(name) }
    val description = localized?.optString("description").orEmpty().ifBlank { skill.optString("description") }
    val aliases = buildList {
      add(name)
      translations?.keys()?.forEach { key ->
        translations.optJSONObject(key)?.optString("displayName")?.takeIf(String::isNotBlank)?.let(::add)
      }
    }.distinct()
    ComposerPaletteItem("skill:$name", title, description, "/skill:$name ", skill = true, aliases = aliases)
  } + commands.objects().mapNotNull { command ->
    val id = command.optString("id").takeIf(String::isNotBlank) ?: return@mapNotNull null
    val name = command.optString("name").takeIf(String::isNotBlank) ?: return@mapNotNull null
    ComposerPaletteItem(
      id = "command:$id",
      title = name,
      description = command.optString("description"),
      insertion = "/$name" + if (command.optBoolean("acceptsArgs")) " " else "",
      skill = false,
      aliases = command.optJSONArray("aliases")?.let { values ->
        (0 until values.length()).mapNotNull { values.optString(it).takeIf(String::isNotBlank) }
      }.orEmpty(),
    )
  }
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
