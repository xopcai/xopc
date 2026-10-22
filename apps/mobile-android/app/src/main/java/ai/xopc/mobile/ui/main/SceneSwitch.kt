package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

@Composable
internal fun SceneSwitch(lifeMode: Boolean, opening: Boolean, onSelect: (Boolean) -> Unit) {
  val motionAllowed = rememberMotionAllowed()
  val offset by animateDpAsState(if (lifeMode) 4.dp else 68.dp,
    tween(if (motionAllowed) 540 else 0), label = "scene-selection")
  Box(Modifier.width(136.dp).height(44.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape),
    contentAlignment = Alignment.CenterStart) {
    Box(Modifier.offset(x = offset).width(64.dp).height(36.dp)
      .background(MaterialTheme.colorScheme.surface, CircleShape))
    Row(Modifier.padding(horizontal = 4.dp).selectableGroup()) {
      listOf(true, false).forEach { life ->
        Box(Modifier.width(64.dp).height(44.dp)
          .selectable(selected = lifeMode == life, enabled = !life || !opening, role = Role.Tab,
            onClick = { onSelect(life) })
          .testTag(if (life) "home-mode-life" else "home-mode-work"), contentAlignment = Alignment.Center) {
          Text(stringResource(if (life) R.string.home_mode_life else R.string.home_mode_work),
            style = MaterialTheme.typography.labelLarge,
            color = if (lifeMode == life) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}
