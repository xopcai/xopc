package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ComposerPaletteItem
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException

internal data class ComposerSlashToken(val start: Int, val caret: Int, val query: String)

internal fun composerSlashToken(value: TextFieldValue): ComposerSlashToken? {
  val caret = value.selection.end
  if (!value.selection.collapsed || value.composition != null || caret == 0 || caret > value.text.length) return null
  val start = value.text.lastIndexOf('/', caret - 1)
  if (start < 0) return null
  if (start > 0 && !value.text[start - 1].isWhitespace()) return null
  val query = value.text.substring(start + 1, caret)
  if (query.any(Char::isWhitespace) || query.startsWith("skill:")) return null
  return ComposerSlashToken(start, caret, query)
}

@Composable
internal fun ComposerPaletteSuggestions(value: TextFieldValue, focused: Boolean, gatewayId: String?,
  locale: String, load: suspend (String) -> List<ComposerPaletteItem>, onChange: (TextFieldValue) -> Unit) {
  var dismissed by remember(gatewayId) { mutableStateOf<Pair<String, Int>?>(null) }
  val rawToken = if (focused) composerSlashToken(value) else null
  val token = rawToken?.takeUnless { dismissed == (value.text to value.selection.end) }
  var catalog by remember(gatewayId, locale) { mutableStateOf<List<ComposerPaletteItem>?>(null) }
  var cacheUntil by remember(gatewayId, locale) { mutableLongStateOf(0L) }
  LaunchedEffect(gatewayId, locale, token != null) {
    if (gatewayId == null || token == null) return@LaunchedEffect
    if (catalog != null && System.currentTimeMillis() < cacheUntil) return@LaunchedEffect
    try {
      catalog = load(locale)
      cacheUntil = System.currentTimeMillis() + 60_000L
    } catch (error: CancellationException) {
      throw error
    } catch (_: Exception) {
      // Leave the current draft editable and allow another slash to retry.
    }
  }
  if (token == null) return
  val suggestions = remember(catalog, token.query, token.start == 0) {
    catalog.orEmpty()
      .mapNotNull { item ->
        if (!item.skill && token.start != 0) return@mapNotNull null
        val rank = item.rank(token.query)
        if (rank >= 0) item to rank else null
      }
      .sortedBy { it.second }
      .take(12)
      .map { it.first }
  }
  if (suggestions.isEmpty()) return
  Surface(
    modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
    shape = MaterialTheme.shapes.medium,
    color = MaterialTheme.colorScheme.surfaceContainerHigh,
  ) {
    Column(Modifier.fillMaxWidth().heightIn(max = 180.dp).verticalScroll(rememberScrollState())) {
      suggestions.forEach { item ->
        Column(
          modifier = Modifier.fillMaxWidth()
            .clickable {
              val text = value.text.replaceRange(token.start, token.caret, item.insertion)
              val nextCaret = token.start + item.insertion.length
              dismissed = if (item.insertion.endsWith(" ")) null else (text to nextCaret)
              onChange(TextFieldValue(text, TextRange(nextCaret)))
            }
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .testTag("composer-palette-${item.id}"),
          verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
          Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
          if (item.description.isNotBlank()) {
            Text(item.description, style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
        }
      }
    }
  }
}
