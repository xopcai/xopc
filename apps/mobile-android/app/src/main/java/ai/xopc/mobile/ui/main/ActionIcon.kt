package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
internal fun ActionIcon(@DrawableRes resource: Int, color: Color = LocalContentColor.current,
  size: Dp = 20.dp,
  contentDescription: String? = if (resource == R.drawable.action_chevron_left) stringResource(R.string.progress_back) else null,
  modifier: Modifier = Modifier) {
  Icon(painterResource(resource), contentDescription, tint = color, modifier = modifier.size(size))
}
