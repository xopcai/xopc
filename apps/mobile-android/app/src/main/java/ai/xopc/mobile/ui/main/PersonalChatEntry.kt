package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun PersonalChatEntry(state: PersonalUiState, onOpen: () -> Unit) {
  val ready = state.agent?.takeIf { it.state == "ready" }
  Card(onClick = onOpen, enabled = !state.agentCreating && !state.agentLoading,
    modifier = Modifier.fillMaxWidth().testTag("conversations-personal-ai-entry"),
    shape = RoundedCornerShape(22.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
    Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 16.dp, top = 14.dp, bottom = 14.dp),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
      PersonalAgentAvatar(state.agentAvatar, state.agent?.appearance ?: "loopi", 54.dp, active = true)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(if (ready == null) stringResource(R.string.personal_chat_entry_title)
          else stringResource(R.string.personal_chat_resume_title, ready.displayName),
          fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1,
          overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurface)
        Text(stringResource(if (ready == null) R.string.personal_chat_entry_subtitle
          else R.string.personal_chat_resume_subtitle), fontSize = 12.sp, lineHeight = 18.sp,
          maxLines = 2, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      if (state.agentCreating || state.agentLoading) BrandLoadingIndicator(extent = 20.dp)
      else ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.primary, size = 16.dp)
    }
  }
  if (state.agentError) Text(stringResource(R.string.personal_agent_error),
    color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("conversations-personal-ai-error"))
}
