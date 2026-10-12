package ai.xopc.mobile.ui.main

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight

/** Only the newly appended range fades; animation state is consumed during drawing. */
@Composable
internal fun StreamingMarkdownText(content: AnnotatedString, streaming: Boolean, modifier: Modifier,
  style: TextStyle, fontWeight: FontWeight?) {
  val alpha = remember { Animatable(1f) }
  var previous by remember { mutableStateOf(content.text) }
  var revealStart by remember { mutableIntStateOf(content.length) }
  var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
  val motionAllowed = if (streaming) rememberMotionAllowed() else false
  val background = MaterialTheme.colorScheme.surface
  val characters = if (streaming) remember { android.icu.text.BreakIterator.getCharacterInstance() } else null
  LaunchedEffect(content.text, streaming, motionAllowed) {
    val old = previous
    previous = content.text
    val safeAppend = if (streaming && motionAllowed && content.length <= 8192 && content.text.startsWith(old) &&
      content.length - old.length in 1..256 && characters != null) {
      characters.setText(content.text); characters.isBoundary(old.length)
    } else false
    if (safeAppend) {
      revealStart = old.length
      alpha.snapTo(0.45f)
      alpha.animateTo(1f, tween(180))
    } else {
      revealStart = content.length
      alpha.snapTo(1f)
    }
  }
  Text(content, modifier = modifier.drawWithContent {
    drawContent()
    val measured = layout
    if (streaming && motionAllowed && alpha.value < 1f && measured != null && measured.layoutInput.text == content && revealStart < content.length) {
      clipPath(measured.getPathForRange(revealStart, content.length)) { drawRect(background, alpha = 1f - alpha.value) }
    }
  }, style = style, fontWeight = fontWeight, onTextLayout = { layout = it })
}
