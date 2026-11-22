package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ComposerPaletteItem
import ai.xopc.mobile.gateway.parseComposerPalette
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposerPaletteTest {
  @Test fun slashTokenTriggersOnlyAtStartOrAfterWhitespace() {
    assertEquals(ComposerSlashToken(0, 5, "help"),
      composerSlashToken(TextFieldValue("/help", TextRange(5))))
    assertEquals(ComposerSlashToken(6, 11, "meet"),
      composerSlashToken(TextFieldValue("hello /meet", TextRange(11))))
    assertNull(composerSlashToken(TextFieldValue("https://example.com/meet", TextRange(24))))
    assertNull(composerSlashToken(TextFieldValue("src/agent/tools", TextRange(15))))
    assertNull(composerSlashToken(TextFieldValue("中文/目录", TextRange(5))))
    assertNull(composerSlashToken(TextFieldValue("/skill:writer", TextRange(13))))
    assertNull(composerSlashToken(TextFieldValue("/help", TextRange(1, 5))))
  }

  @Test fun paletteRankingMatchesHarmonySevenTierOrder() {
    val exact = ComposerPaletteItem("skill:meet", "Meeting", "Plan notes", "/skill:meet ", skill = true)
    val aliasExact = ComposerPaletteItem("skill:notes", "Summarizer", "Notes", "/skill:notes ", skill = true, aliases = listOf("meet"))
    val prefix = ComposerPaletteItem("skill:meeting-prep", "Meeting Prep", "", "/skill:meeting-prep ", skill = true)
    val descOnly = ComposerPaletteItem("skill:calendar", "Calendar", "Schedule a meet", "/skill:calendar ", skill = true)
    assertEquals(0, exact.rank("meet"))
    assertEquals(1, aliasExact.rank("meet"))
    assertEquals(2, prefix.rank("meet"))
    assertEquals(100, descOnly.rank("meet"))
    assertEquals(-1, descOnly.rank("nonexistent"))
  }

  @Test fun parseComposerPaletteLocalizesSkillsAndKeepsCrossLocaleAliases() {
    val commandsJson = """{"payload":{"commands":[{"id":"help","name":"help","description":"Show help","acceptsArgs":false}]}}"""
    val skillsJson = """{"payload":{"catalog":[{"name":"web-search","description":"Search the web","enabled":true,"localizations":{"zh-CN":{"displayName":"网页搜索","description":"联网检索"},"en":{"displayName":"Web Search","description":"Search online"}}}]}}"""
    val items = parseComposerPalette(commandsJson, skillsJson, "zh_CN")
    assertEquals(2, items.size)
    val skill = items.first { it.skill }
    assertEquals("网页搜索", skill.title)
    assertEquals("联网检索", skill.description)
    assertTrue("Web Search" in skill.aliases)
    assertEquals(1, skill.rank("Web Search"))
    val command = items.first { !it.skill }
    assertEquals("/help", command.insertion)
  }
}
