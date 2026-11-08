package ai.xopc.mobile.ui.main

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ai.xopc.mobile.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal class TransientComposerNotice(private val scope: CoroutineScope) {
  var message by mutableStateOf(""); private set
  private var expiry: Job? = null

  fun show(text: String) {
    clear()
    if (text.isBlank()) return
    message = text
    expiry = scope.launch { delay(6_000); message = "" }
  }

  fun clear() { expiry?.cancel(); expiry = null; message = "" }
}

internal fun ConnectionUiState.clearComposerFeedback(gatewayId: String?, conversationId: String?, quick: Boolean): ConnectionUiState =
  if (profile?.gatewayId != gatewayId || selectedConversationId != conversationId) this
  else if (quick) copy(quickError = false, quickAttachmentError = false)
  else copy(sendError = false, sendErrorDetail = null, attachmentError = false)

@Composable
internal fun ComposerFeedback(message: String, onDismiss: () -> Unit,
  modifier: Modifier = Modifier, autoDismiss: Boolean = true, scopeKey: Any? = null) {
  DisposableEffect(scopeKey) { onDispose { onDismiss() } }
  LaunchedEffect(message, scopeKey, autoDismiss) {
    if (message.isNotBlank() && autoDismiss) { delay(6_000); onDismiss() }
  }
  if (message.isBlank()) return
  Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Text(message, style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, modifier = Modifier.weight(1f))
    TextButton(onClick = onDismiss) { Text(stringResource(R.string.assistant_close)) }
  }
}
