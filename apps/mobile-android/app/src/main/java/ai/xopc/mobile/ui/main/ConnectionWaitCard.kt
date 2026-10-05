package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionWaitCard(state: ConnectionWaitUiState, onRetry: () -> Unit) {
  val wait = state.snapshot?.wait ?: return
  if (wait.phase == "ready") return
  var detailOpen by remember(wait.id) { mutableStateOf(false) }
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
          Text(stringResource(if (need.authorizationMode == "desktop") R.string.connection_wait_desktop
            else R.string.connection_wait_browser), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      Text(stringResource(R.string.connection_wait_android_readonly),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      TextButton(onClick = { detailOpen = false }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.assistant_close))
      }
    }
  }
}
