package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Shared Loopi loading mark for short, local operations. */
@Composable
internal fun BrandLoadingIndicator(modifier: Modifier = Modifier, extent: Dp = 24.dp) {
  val label = stringResource(R.string.brand_loading)
  Box(modifier.defaultMinSize(minWidth = extent, minHeight = extent)
    .semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
    LoopiIcon(extent = extent, active = true, working = true,
      modifier = Modifier.testTag("brand-loading-logo"))
  }
}

/** Full-width loading region, matching Harmony's centered branded loading state. */
@Composable
internal fun BrandLoadingPanel(modifier: Modifier = Modifier, minHeight: Dp = 220.dp) {
  Column(modifier.fillMaxWidth().heightIn(min = minHeight),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
    BrandLoadingIndicator(extent = 42.dp)
    Text(stringResource(R.string.brand_loading), style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
