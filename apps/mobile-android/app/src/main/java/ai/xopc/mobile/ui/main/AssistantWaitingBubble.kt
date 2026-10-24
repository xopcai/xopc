package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import android.os.SystemClock
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable
internal fun AssistantWaitingBubble(runId: String, narration: String?, connected: Boolean) {
  var showNarration by remember(runId) { mutableStateOf(false) }
  LaunchedEffect(runId) {
    val started = SystemClock.elapsedRealtime()
    while (true) {
      delay(1000)
      showNarration = SystemClock.elapsedRealtime() - started >= 10_000
    }
  }
  val waitingLabel = stringResource(R.string.assistant_running)
  Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("assistant-waiting")) {
    if (!connected) Text(stringResource(R.string.assistant_connection_interrupted),
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    else {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.width(72.dp).height(44.dp).background(MaterialTheme.colorScheme.surfaceContainer, CircleShape)
          .padding(horizontal = 12.dp).semantics { contentDescription = waitingLabel }) {
        repeat(3) { index ->
          WaitingReplyDot(index, android.animation.ValueAnimator.areAnimatorsEnabled())
        }
      }
      if (showNarration && !narration.isNullOrBlank()) Text(narration,
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
  }
}

@Composable
private fun WaitingReplyDot(index: Int, animate: Boolean) {
  val lift = if (animate) {
    val transition = rememberInfiniteTransition(label = "waiting-dot-$index")
    transition.animateFloat(initialValue = 0f, targetValue = 1f,
      animationSpec = infiniteRepeatable(tween(600, easing = FastOutSlowInEasing),
        repeatMode = RepeatMode.Reverse, initialStartOffset = StartOffset(index * 150)),
      label = "waiting-dot-lift-$index")
  } else rememberUpdatedState(0f)
  Box(Modifier.size(7.dp).graphicsLayer {
    alpha = 0.4f + lift.value * 0.45f
    translationY = -3.dp.toPx() * lift.value
    scaleX = 0.92f + lift.value * 0.16f
    scaleY = scaleX
  }.background(MaterialTheme.colorScheme.onSurfaceVariant, CircleShape))
}

/** Reveal only newly confirmed answers; transport drafts never reach the Markdown surface. */
@Composable
internal fun rememberAnswerText(text: String, reveal: Boolean): String {
  var displayed by remember { mutableStateOf(if (reveal) "" else text) }
  LaunchedEffect(text) {
    if (!reveal || !android.animation.ValueAnimator.areAnimatorsEnabled()) { displayed = text; return@LaunchedEffect }
    var end = 0
    val step = maxOf(12, (text.length + 31) / 32)
    while (end < text.length) {
      end = minOf(text.length, end + step)
      if (end < text.length && text[end - 1].isHighSurrogate()) end++
      displayed = text.substring(0, end)
      delay(24)
    }
  }
  return displayed
}
