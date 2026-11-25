package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
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
  Column(Modifier.fillMaxWidth()
    .height(minOf(height, (LocalConfiguration.current.screenHeightDp * 0.85f).dp))
    .padding(bottom = 16.dp)
    .testTag("chat-options-panel")) {
    XopcSheetHeader(
      title = title,
      onClose = onClose,
      closeTag = "chat-options-close",
    )
    Column(
      Modifier.weight(1f).fillMaxWidth().padding(horizontal = XopcDesignTokens.SheetPaddingX),
      verticalArrangement = Arrangement.spacedBy(8.dp),
      content = content,
    )
  }
}

@Composable
internal fun ChatOptionsSkeleton() {
  XopcListSkeleton(modifier = Modifier.testTag("chat-options-loading"), rows = 4)
}
