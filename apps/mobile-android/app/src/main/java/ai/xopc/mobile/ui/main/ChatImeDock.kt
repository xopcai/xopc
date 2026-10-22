package ai.xopc.mobile.ui.main

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

internal class ChatMessagePadding(private val composerInsets: PaddingValues,
  private val top: Dp, private val extraBottom: Dp) : PaddingValues {
  override fun calculateLeftPadding(layoutDirection: LayoutDirection) = 8.dp
  override fun calculateRightPadding(layoutDirection: LayoutDirection) = 8.dp
  override fun calculateTopPadding() = top
  // LazyColumn reads this during measure, after Scaffold measures the current composer height.
  override fun calculateBottomPadding() = composerInsets.calculateBottomPadding() + extraBottom
}

@Composable
internal fun ChatImeDock(content: @Composable () -> Unit) {
  val ime = WindowInsets.ime
  val navigationBars = WindowInsets.navigationBars
  Box(Modifier.clipToBounds().layout { measurable, constraints ->
    val dock = measurable.measure(constraints)
    // Share the IME's displacement instead of racing it with a separate height animation.
    val covered = (ime.getBottom(this) - navigationBars.getBottom(this)).coerceIn(0, dock.height)
    layout(dock.width, dock.height - covered) { dock.placeRelative(0, 0) }
  }) { content() }
}
