package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import kotlin.math.abs

@Composable
internal fun Modifier.chatSceneSwipe(lifeMode: Boolean, enabled: Boolean, onSelect: (Boolean) -> Unit): Modifier {
  val motionAllowed = rememberMotionAllowed()
  val latestOnSelect by rememberUpdatedState(onSelect)
  var drag by remember(lifeMode) { mutableFloatStateOf(0f) }
  var dragging by remember(lifeMode) { mutableStateOf(false) }
  val animatedDrag = animateFloatAsState(drag,
    if (dragging || !motionAllowed) snap() else tween(260, easing = LinearOutSlowInEasing), label = "scene-drag")
  return graphicsLayer { translationX = if (motionAllowed) animatedDrag.value else 0f }
    .pointerInput(lifeMode, enabled) {
      if (!enabled) return@pointerInput
      val edge = 24.dp.toPx()
      val threshold = 64.dp.toPx()
      awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        if (down.position.x < edge || down.position.x > size.width - edge) return@awaitEachGesture
        var distance = Offset.Zero
        var claimed = false
        try {
          while (true) {
            val event = awaitPointerEvent()
            val change = event.changes.firstOrNull { it.id == down.id } ?: break
            // Nested horizontal scrollers and text selection own consumed gestures.
            if (change.isConsumed || event.changes.count { it.pressed } > 1) break
            distance = change.position - down.position
            if (!claimed) {
              if (abs(distance.y) > viewConfiguration.touchSlop && abs(distance.y) * 1.5f >= abs(distance.x)) break
              if (abs(distance.x) > viewConfiguration.touchSlop && abs(distance.x) > abs(distance.y) * 1.5f) {
                if ((distance.x > 0) == lifeMode) break
                claimed = true
                dragging = true
              }
            }
            if (claimed) {
              change.consume()
              drag = (distance.x * 0.22f).coerceIn(-48.dp.toPx(), 48.dp.toPx())
            }
            if (!change.pressed) {
              if (claimed && abs(distance.x) >= threshold && abs(distance.x) > abs(distance.y) * 1.5f &&
                (distance.x > 0) != lifeMode) latestOnSelect(!lifeMode)
              break
            }
          }
        } finally {
          dragging = false
          drag = 0f
        }
      }
    }
}

@Composable
internal fun SceneSwitch(lifeMode: Boolean, opening: Boolean, onSelect: (Boolean) -> Unit) {
  val motionAllowed = rememberMotionAllowed()
  val offset = animateDpAsState(if (lifeMode) 4.dp else 68.dp,
    tween(if (motionAllowed) 260 else 0, easing = LinearOutSlowInEasing), label = "scene-selection")
  Box(Modifier.width(136.dp).height(44.dp).clip(CircleShape)
    .background(MaterialTheme.colorScheme.surfaceContainerHigh),
    contentAlignment = Alignment.CenterStart) {
    Box(Modifier.offset { IntOffset(offset.value.roundToPx(), 0) }.width(64.dp).height(36.dp)
      .background(MaterialTheme.colorScheme.surface, CircleShape).testTag("scene-selection"))
    Row(Modifier.padding(horizontal = 4.dp).selectableGroup()) {
      listOf(true, false).forEach { life ->
        Box(Modifier.width(64.dp).height(44.dp)
          .selectable(selected = lifeMode == life, enabled = !life || !opening, role = Role.Tab,
            interactionSource = null, indication = null,
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
