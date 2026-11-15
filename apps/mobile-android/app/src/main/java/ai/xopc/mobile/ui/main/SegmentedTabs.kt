package ai.xopc.mobile.ui.main

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

internal data class SegmentOption<T>(
  val value: T,
  val label: String,
  val tag: String,
  val icon: Int? = null,
  val count: Int? = null,
)

private val segmentEasing = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)

@Composable
internal fun <T> SegmentedTabs(
  options: List<SegmentOption<T>>,
  selected: T?,
  onSelect: (T) -> Unit,
  modifier: Modifier = Modifier,
  minimumSegmentWidth: Dp = 64.dp,
  enabled: Boolean = true,
) {
  if (options.isEmpty()) return
  val fontScale = LocalDensity.current.fontScale.coerceAtLeast(1f)
  val scheme = MaterialTheme.colorScheme
  val selection = options.indexOfFirst { it.value == selected }
  BoxWithConstraints(modifier.fillMaxWidth()) {
    val segmentWidth = maxOf(maxWidth / options.size, minimumSegmentWidth * fontScale)
    val thumb by animateDpAsState(segmentWidth * selection.coerceAtLeast(0),
      tween(250, easing = segmentEasing), label = "Segment position")
    Box(Modifier.horizontalScroll(rememberScrollState())) {
      Box(Modifier.clip(CircleShape).background(scheme.surfaceContainer)) {
        if (selection >= 0) {
          Box(Modifier.matchParentSize().offset { IntOffset(thumb.roundToPx(), 0) }) {
            Box(Modifier.align(Alignment.CenterStart).width(segmentWidth)
              .heightIn(min = 48.dp * fontScale).background(scheme.surfaceContainerHighest, CircleShape)
              .testTag("segmented-tab-indicator"))
          }
        }
        Row(Modifier.selectableGroup()) {
          options.forEach { option ->
            val active = selected == option.value
            val tint by animateColorAsState(if (active) scheme.onSurface else scheme.onSurfaceVariant,
              tween(150), label = "Segment label color")
            Row(
              Modifier.width(segmentWidth).heightIn(min = 48.dp * fontScale).clip(CircleShape)
                .testTag(option.tag).selectable(active, enabled = enabled, role = Role.Tab) { onSelect(option.value) }
                .padding(horizontal = 8.dp),
              horizontalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterHorizontally),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              option.icon?.let { ActionIcon(it, color = tint, size = 16.dp) }
              Text(option.label, color = tint, style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.weight(1f, fill = false), textAlign = TextAlign.Center,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
              option.count?.let { Text(it.toString(), color = tint, style = MaterialTheme.typography.labelSmall) }
            }
          }
        }
      }
    }
  }
}
