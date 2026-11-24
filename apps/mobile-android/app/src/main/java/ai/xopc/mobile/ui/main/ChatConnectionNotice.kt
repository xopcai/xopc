package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.theme.themedCorners
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

internal fun chatConnectionNoticeTitle(status: String, stage: Int, syncFailed: Boolean): Int? =
  when {
    status == "connected" -> if (syncFailed) R.string.chat_sync_interrupted else null
    stage == 0 -> null
    status == "network_offline" -> R.string.chat_network_offline
    stage == 2 -> R.string.chat_gateway_unreachable
    else -> R.string.chat_network_reconnecting
  }

@Composable
internal fun ChatConnectionNotice(status: String, stage: Int, syncFailed: Boolean, onRetry: () -> Unit) {
  val title = chatConnectionNoticeTitle(status, stage, syncFailed) ?: return
  val detail = when (title) {
    R.string.chat_network_offline -> R.string.chat_network_auto_resume
    R.string.chat_gateway_unreachable -> R.string.chat_network_auto_retry
    else -> null
  }
  val action = when (title) {
    R.string.chat_sync_interrupted -> R.string.chat_retry_sync
    R.string.chat_gateway_unreachable -> R.string.chat_reconnect_now
    else -> null
  }
  Row(
    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 4.dp)
      .heightIn(min = 44.dp).background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(14))
      .padding(start = 12.dp, end = 4.dp).testTag("chat-network-notice"),
    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(painterResource(R.drawable.action_refresh), contentDescription = null,
      modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    Column(Modifier.weight(1f).padding(vertical = 8.dp).semantics { liveRegion = LiveRegionMode.Polite }) {
      Text(stringResource(title), style = MaterialTheme.typography.labelLarge)
      detail?.let { Text(stringResource(it), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    if (action != null) TextButton(onClick = onRetry, modifier = Modifier.testTag("chat-network-retry")) {
      Text(stringResource(action))
    }
  }
}
