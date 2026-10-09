package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun ChatOptionsPanel(title: String, height: Dp = 448.dp, onClose: () -> Unit,
  content: @Composable ColumnScope.() -> Unit) {
  val closeLabel = stringResource(R.string.assistant_close)
  Column(Modifier.fillMaxWidth()
    .height(minOf(height, (LocalConfiguration.current.screenHeightDp * 0.85f).dp))
    .padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 16.dp)
    .testTag("chat-options-panel"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(title, Modifier.weight(1f), fontSize = 20.sp, fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurface)
      IconButton(onClick = onClose, modifier = Modifier.size(44.dp)
        .semantics { contentDescription = closeLabel }.testTag("chat-options-close")) {
        Text("×", fontSize = 28.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    content()
  }
}

@Composable
internal fun ChatOptionsSkeleton() {
  Column(Modifier.fillMaxWidth().testTag("chat-options-loading"),
    verticalArrangement = Arrangement.spacedBy(8.dp)) {
    repeat(4) {
      Box(Modifier.fillMaxWidth().height(52.dp)
        .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(12.dp)))
    }
  }
}
