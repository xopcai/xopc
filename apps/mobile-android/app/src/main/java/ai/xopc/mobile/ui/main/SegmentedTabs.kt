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
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import ai.xopc.mobile.theme.themedCorners
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp
import kotlin.math.floor

internal data class SegmentOption<T>(
  val value: T,
  val label: String,
  val tag: String,
  val icon: Int? = null,
  val count: Int? = null,
  val minimumWidth: Dp? = null,
)

private val segmentEasing = XopcMotionTokens.StandardEasing

@Composable
internal fun <T> SegmentedTabs(
  options: List<SegmentOption<T>>,
  selected: T?,
  onSelect: (T) -> Unit,
  modifier: Modifier = Modifier,
  minimumSegmentWidth: Dp = 64.dp,
  enabled: Boolean = true,
  swipeToSelect: Boolean = false,
  pager: PagerState? = null,
) {
  if (options.isEmpty()) return
  val motionAllowed = rememberMotionAllowed()
  val density = LocalDensity.current
  val fontScale = density.fontScale.coerceAtLeast(1f)
  val textMeasurer = rememberTextMeasurer(cacheSize = options.size * 2)
  val labelStyle = MaterialTheme.typography.labelLarge
  val countStyle = MaterialTheme.typography.labelSmall
  val scroll = rememberScrollState()
  val scheme = MaterialTheme.colorScheme
  val selection = options.indexOfFirst { it.value == selected }
  val dark = scheme.background.luminance() < 0.5f
  val shape = themedCorners(18, fontScale)
  val selectedFill = if (dark) scheme.surfaceContainerHigh else scheme.surface
  val selectedLabel = if (dark) scheme.onSurface else scheme.primary
  BoxWithConstraints(modifier.fillMaxWidth()) {
    val minimumWidths = options.map { option ->
      val labelWidth = textMeasurer.measure(option.label, labelStyle.copy(fontWeight = FontWeight.Bold),
        maxLines = 1, softWrap = false).size.width
      val countWidth = option.count?.let {
        textMeasurer.measure(it.toString(), countStyle, maxLines = 1, softWrap = false).size.width
      }
      val padding = if (option.minimumWidth != null) 6.dp else 8.dp
      val contentWidth = with(density) { (labelWidth + (countWidth ?: 0)).toDp() } + padding * 2 +
        (if (option.icon != null) 21.dp else 0.dp) + (if (countWidth != null) 5.dp else 0.dp)
      maxOf((option.minimumWidth ?: minimumSegmentWidth) * fontScale, contentWidth)
    }
    val trackWidth = minimumWidths.fold(0.dp, Dp::plus)
    val extra = (maxWidth - trackWidth).coerceAtLeast(0.dp) / options.size
    val widths = minimumWidths.map { it + extra }
    val starts = widths.runningFold(0.dp, Dp::plus)
    val selectedStart = starts[selection.coerceAtLeast(0)]
    val selectedWidth = widths[selection.coerceAtLeast(0)]
    val segmentMs = xopcMotionDuration(XopcMotionTokens.EmphasisMs, motionAllowed)
    val thumb by animateDpAsState(selectedStart,
      tween(segmentMs, easing = segmentEasing), label = "Segment position")
    val thumbWidth by animateDpAsState(selectedWidth, tween(segmentMs, easing = segmentEasing),
      label = "Segment width")
    val viewport = maxWidth
    LaunchedEffect(selected, selectedStart, selectedWidth, viewport) {
      if (selection < 0) return@LaunchedEffect
      val start = with(density) { selectedStart.roundToPx() }
      val end = with(density) { (selectedStart + selectedWidth).roundToPx() }
      val viewportWidth = with(density) { viewport.roundToPx() }
      val target = when {
        start < scroll.value || end - start > viewportWidth -> start
        end > scroll.value + viewportWidth -> end - viewportWidth
        else -> scroll.value
      }
      if (target != scroll.value) scroll.animateScrollTo(target)
    }
    val fits = trackWidth <= viewport
    val swipe = if (swipeToSelect && enabled && fits && selected != null)
      Modifier.swipePageSelection(options.map { it.value }, selected, onSelect = onSelect) else Modifier
    Box(Modifier.fillMaxWidth().then(swipe).horizontalScroll(scroll, enabled = !fits)) {
      Box(Modifier.clip(shape).background(scheme.surfaceContainer)) {
        if (selection >= 0) {
          val indicator = if (pager == null) {
            Modifier.offset { IntOffset(thumb.roundToPx(), 0) }.width(thumbWidth)
          } else {
            Modifier.layout { measurable, constraints ->
              val page = (pager.currentPage + pager.currentPageOffsetFraction).coerceIn(0f, widths.lastIndex.toFloat())
              val left = floor(page).toInt()
              val right = (left + 1).coerceAtMost(widths.lastIndex)
              val fraction = page - left
              val width = lerp(widths[left], widths[right], fraction).roundToPx()
              val child = measurable.measure(constraints.copy(minWidth = width, maxWidth = width))
              layout(constraints.maxWidth, child.height) {
                child.placeRelative(lerp(starts[left], starts[right], fraction).roundToPx(), 0)
              }
            }
          }
          Box(Modifier.matchParentSize()) {
            Box(Modifier.align(Alignment.CenterStart).then(indicator)
              .heightIn(min = 48.dp * fontScale).background(selectedFill, shape)
              .testTag("segmented-tab-indicator"))
          }
        }
        Row(Modifier.selectableGroup()) {
          options.forEachIndexed { index, option ->
            val active = selected == option.value
            val tint by animateColorAsState(if (active) selectedLabel else scheme.onSurfaceVariant,
              tween(xopcMotionDuration(XopcMotionTokens.MicroMs, motionAllowed)), label = "Segment label color")
            Row(
              Modifier.width(widths[index]).heightIn(min = 48.dp * fontScale).clip(shape)
                .testTag(option.tag).selectable(active, enabled = enabled, role = Role.Tab) { onSelect(option.value) }
                .padding(horizontal = if (option.minimumWidth != null) 6.dp else 8.dp),
              horizontalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterHorizontally),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              option.icon?.let { ActionIcon(it, color = tint, size = 16.dp) }
              Text(option.label, color = tint, style = labelStyle,
                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                modifier = Modifier.weight(1f, fill = false), textAlign = TextAlign.Center,
                maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
              option.count?.let { Text(it.toString(), color = tint, style = countStyle, maxLines = 1, softWrap = false) }
            }
          }
        }
      }
    }
  }
}
