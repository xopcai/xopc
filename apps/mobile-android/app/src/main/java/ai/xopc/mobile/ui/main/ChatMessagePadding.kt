package ai.xopc.mobile.ui.main

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

internal class ChatMessagePadding(private val composerInsets: PaddingValues,
  private val top: Dp, private val extraBottom: Dp) : PaddingValues {
  override fun calculateLeftPadding(layoutDirection: LayoutDirection) = 0.dp
  override fun calculateRightPadding(layoutDirection: LayoutDirection) = 0.dp
  override fun calculateTopPadding() = top
  // LazyColumn reads this during measure, after Scaffold measures the current composer height.
  override fun calculateBottomPadding() = composerInsets.calculateBottomPadding() + extraBottom
}
