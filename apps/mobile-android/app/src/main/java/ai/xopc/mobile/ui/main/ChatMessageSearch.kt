package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationMessage
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

internal fun messageSearchContent(message: ConversationMessage, kind: String): String = when (kind) {
  "files", "images" -> {
    val images = kind == "images"
    (message.media.filter { it.mimeType.startsWith("image/") == images }.map { it.name } +
      message.outcome?.artifacts.orEmpty().filter {
        it.kind != "site" && (it.mimeType?.startsWith("image/") == true || it.kind == "image") == images
      }.map { it.title }).distinct().joinToString("\n")
  }
  "links" -> (Regex("https?://[^\\s<>]+", RegexOption.IGNORE_CASE).findAll(message.text)
    .map { it.value.trimEnd('.', ',', ')', ']', '。', '，') }.toList() +
    message.references.mapNotNull { it.url } + message.outcome?.artifacts.orEmpty()
      .mapNotNull { it.shareUrl ?: it.uri?.takeIf { uri -> uri.startsWith("https://") || uri.startsWith("http://") } })
    .distinct().joinToString("\n")
  else -> message.text
}

@Composable
internal fun ChatMessageSearch(messages: List<ConversationMessage>, hasOlder: Boolean, loadingOlder: Boolean,
  onLoadOlder: () -> Unit, onClose: () -> Unit, onSelect: (String) -> Unit) {
  var query by remember { mutableStateOf("") }
  var kind by remember { mutableStateOf("messages") }
  val focus = remember { FocusRequester() }
  val keyboard = LocalSoftwareKeyboardController.current
  val close = { keyboard?.hide(); onClose() }
  Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false,
    decorFitsSystemWindows = false)) {
    LaunchedEffect(Unit) { focus.requestFocus(); keyboard?.show() }
    val results = remember(messages, query, kind) {
      messages.map { it to messageSearchContent(it, kind) }.filter { (_, text) ->
        text.isNotBlank() && (query.isBlank() && kind != "messages" ||
          query.isNotBlank() && text.contains(query.trim(), ignoreCase = true)) }
    }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerLow)
      .statusBarsPadding().navigationBarsPadding().imePadding().testTag("chat-message-search-screen")) {
      LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("chat-search-results"),
        contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(results, key = { it.first.id }) { (message, text) ->
          Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface, RoundedCornerShape(16.dp))
            .clickable { keyboard?.hide(); onSelect(message.id) }.padding(16.dp)
            .testTag("chat-search-result-${message.id}")) {
            Text(text, maxLines = 4, overflow = TextOverflow.Ellipsis,
              style = MaterialTheme.typography.bodyLarge)
          }
        }
        if (query.isNotBlank() && results.isEmpty()) item {
          Text(stringResource(R.string.chat_search_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (hasOlder && (query.isNotBlank() || kind != "messages")) item {
          TextButton(onClick = onLoadOlder, enabled = !loadingOlder, modifier = Modifier.testTag("chat-search-older")) {
            Text(stringResource(R.string.assistant_older_messages))
          }
        }
      }
      Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          listOf("messages" to R.string.chat_search_messages, "files" to R.string.chat_search_files,
            "links" to R.string.chat_search_links, "images" to R.string.chat_search_images).forEach { (id, label) ->
            FilledTonalButton(onClick = { kind = id; focus.requestFocus(); keyboard?.show() },
              colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.surface,
                contentColor = if (kind == id) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface),
              shape = RoundedCornerShape(18.dp), contentPadding = PaddingValues(horizontal = 12.dp),
              modifier = Modifier.heightIn(min = 44.dp).testTag("chat-search-category-$id").semantics { selected = kind == id }) {
              Text(stringResource(label))
            }
          }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Row(Modifier.weight(1f).heightIn(min = 48.dp).background(MaterialTheme.colorScheme.surface, CircleShape)
            .padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionIcon(R.drawable.action_search, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 20.dp)
            BasicTextField(query, { query = it.take(500) }, singleLine = true,
              textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
              modifier = Modifier.weight(1f).focusRequester(focus).testTag("chat-message-search-input"),
              keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
              keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
              decorationBox = { field ->
                Box { if (query.isEmpty()) Text(stringResource(R.string.assistant_step_search), color = MaterialTheme.colorScheme.onSurfaceVariant); field() }
              })
          }
          FilledIconButton(onClick = close, modifier = Modifier.size(48.dp).testTag("chat-search-close"),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.surface,
              contentColor = MaterialTheme.colorScheme.onSurface)) {
            ActionIcon(R.drawable.action_close, contentDescription = stringResource(R.string.assistant_close))
          }
        }
      }
    }
  }
}
