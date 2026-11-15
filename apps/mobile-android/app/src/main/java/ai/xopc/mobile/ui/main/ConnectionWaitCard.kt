package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConnectionWaitSnapshot
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionWaitCard(state: ConnectionWaitUiState, onRetry: () -> Unit,
  onAction: suspend (ConnectionWaitSnapshot, String, String?, String?) -> String?) {
  val snapshot = state.snapshot ?: return
  val wait = snapshot.wait ?: return
  if (wait.phase == "ready") return
  var detailOpen by remember(wait.id) { mutableStateOf(false) }
  var busy by remember(wait.id) { mutableStateOf(false) }
  var failed by remember(wait.id) { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val browser = LocalUriHandler.current
  fun act(action: String, needKey: String? = null, accountId: String? = null) {
    if (busy) return
    busy = true
    failed = false
    scope.launch {
      try {
        onAction(snapshot, action, needKey, accountId)?.let { raw ->
          val url = Uri.parse(raw)
          require(url.scheme == "https" && url.host != null && url.userInfo == null)
          browser.openUri(raw)
        }
      } catch (error: CancellationException) { throw error }
      catch (_: Exception) { failed = true; onRetry() }
      finally { busy = false }
    }
  }
  Card(modifier = Modifier.fillMaxWidth().testTag("connection-wait-card")) {
    Row(modifier = Modifier.fillMaxWidth().padding(12.dp),
      horizontalArrangement = Arrangement.SpaceBetween) {
      Column(modifier = Modifier.weight(1f)) {
        Text(stringResource(if (wait.phase == "queued") R.string.connection_wait_resuming
          else R.string.connection_wait_title), style = MaterialTheme.typography.titleSmall,
          fontWeight = FontWeight.Medium)
        Text(wait.summary, style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
          overflow = TextOverflow.Ellipsis)
      }
      TextButton(onClick = { detailOpen = true }, modifier = Modifier.testTag("connection-wait-details")) {
        Text(stringResource(R.string.connection_wait_details))
      }
    }
    if (state.error) TextButton(onClick = onRetry, modifier = Modifier.testTag("connection-wait-retry")) {
      Text(stringResource(R.string.assistant_retry))
    }
  }
  if (detailOpen) ModalBottomSheet(onDismissRequest = { detailOpen = false }) {
    Column(modifier = Modifier.fillMaxWidth().heightIn(max = 600.dp)
      .verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      Text(stringResource(R.string.connection_wait_title), style = MaterialTheme.typography.titleLarge)
      Text(wait.summary, style = MaterialTheme.typography.bodyLarge)
      wait.timeRange?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
      wait.needs.forEach { need ->
        Column(verticalArrangement = Arrangement.spacedBy(4.dp),
          modifier = Modifier.fillMaxWidth().testTag("connection-wait-need-${need.key}")) {
          Text(need.label, fontWeight = FontWeight.Medium)
          if (need.capabilities.isNotEmpty()) Text(need.capabilities.joinToString(" · "),
            style = MaterialTheme.typography.bodySmall)
          need.reason?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
          when {
            wait.phase == "review_scope" -> Unit
            need.phase == "choose_account" && need.authorizationMode == "browser" -> need.accounts.forEach { account ->
              TextButton(onClick = { act("select_account", need.key, account.id) }, enabled = !busy) { Text(account.label) }
            }
            need.phase in setOf("connect", "reconnect") && need.authorizationMode == "browser" -> {
              Button(onClick = { act("connect", need.key) }, enabled = !busy,
                modifier = Modifier.testTag("connection-wait-connect-${need.key}")) {
                Text(stringResource(if (need.phase == "reconnect") R.string.connection_wait_reconnect else R.string.connection_wait_connect))
              }
            }
            need.phase == "authorizing" -> Text(stringResource(R.string.connection_wait_browser), style = MaterialTheme.typography.bodySmall)
            need.phase != "ready" -> Text(stringResource(R.string.connection_wait_desktop), style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
      if (failed) Text(stringResource(R.string.connection_wait_failed), color = MaterialTheme.colorScheme.error)
      if (wait.phase == "review_scope") {
        Button(onClick = { act("confirm_scope") }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
          Text(stringResource(R.string.connection_wait_confirm))
        }
      }
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = { act("check") }, enabled = !busy) { Text(stringResource(R.string.connection_wait_check)) }
        TextButton(onClick = { act("cancel") }, enabled = !busy) { Text(stringResource(R.string.connection_wait_cancel)) }
      }
      TextButton(onClick = { detailOpen = false }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.assistant_close))
      }
    }
  }
}
