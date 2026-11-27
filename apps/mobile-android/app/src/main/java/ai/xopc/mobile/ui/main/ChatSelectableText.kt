package ai.xopc.mobile.ui.main

import android.content.Context
import android.content.Intent
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.contextmenu.builder.item
import androidx.compose.foundation.text.contextmenu.modifier.appendTextContextMenuComponents
import androidx.compose.foundation.text.input.OutputTransformation
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import ai.xopc.mobile.R
import ai.xopc.mobile.theme.themedCorners
import kotlin.math.roundToInt

@Composable
internal fun MessageMenuItem(@StringRes label: Int, @DrawableRes icon: Int, id: String,
  enabled: Boolean = true, onClick: () -> Unit) {
  DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = onClick,
    leadingIcon = { Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(20.dp)) },
    enabled = enabled, modifier = Modifier.testTag("message-$id-action"))
  HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
}

internal fun shareMessageText(context: Context, text: String) {
  if (text.isEmpty()) return
  val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
  context.startActivity(Intent.createChooser(send, null))
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ChatSelectableText(source: String, pressInWindow: Offset?,
  onCopy: (String) -> Unit, onDone: () -> Unit) {
  val context = LocalContext.current
  val shareLabel = stringResource(R.string.conversations_share)
  val document = remember(source) {
    markdownSelectableText(source).takeIf { it.isNotBlank() }
      ?: AnnotatedString(source)
  }
  val state = rememberTextFieldState(document.text)
  val formatting = remember(document) {
    OutputTransformation {
      document.spanStyles.forEach { addStyle(it.item, it.start, it.end) }
    }
  }
  val focus = remember { FocusRequester() }
  var coordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
  var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
  var initialSelection by remember { mutableStateOf<TextRange?>(null) }
  var initialized by remember { mutableStateOf(false) }
  var receivedFocus by remember { mutableStateOf(false) }
  val selectedText = { state.text.subSequence(state.selection.min, state.selection.max).toString() }

  LaunchedEffect(layout != null, coordinates != null) {
    val textLayout = layout ?: return@LaunchedEffect
    val field = coordinates?.takeIf { it.isAttached } ?: return@LaunchedEffect
    if (initialized || document.isEmpty()) return@LaunchedEffect
    val point = pressInWindow?.let(field::windowToLocal) ?: Offset.Zero
    val offset = textLayout.getOffsetForPosition(point).coerceIn(0, document.lastIndex)
    val word = textLayout.getWordBoundary(offset)
    val selection = if (word.collapsed) TextRange(0, document.length) else word
    initialized = true
    focus.requestFocus()
    state.edit { this.selection = selection }
    initialSelection = selection
  }

  BasicTextField(state = state, readOnly = true, outputTransformation = formatting,
    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface,
      lineHeight = 24.sp),
    onTextLayout = { getResult -> layout = getResult() },
    modifier = Modifier.fillMaxWidth().testTag("message-inline-selection")
      .focusRequester(focus).onFocusChanged {
        if (it.isFocused) receivedFocus = true
        else if (receivedFocus) onDone()
      }
      .onGloballyPositioned { coordinates = it }
      .pointerInput(Unit) {
        awaitEachGesture {
          awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
          initialSelection = null
        }
      }
      .appendTextContextMenuComponents {
        if (!state.selection.collapsed) item("xopc-share-text", shareLabel, R.drawable.message_share) {
          shareMessageText(context, selectedText())
          close()
        }
      })

  val textLayout = layout
  val field = coordinates
  if (initialSelection == state.selection && !state.selection.collapsed && textLayout != null && field?.isAttached == true) {
    val selectionBounds = textLayout.getBoundingBox(state.selection.min)
    val origin = field.localToWindow(selectionBounds.topLeft)
    val bounds = Rect(origin, selectionBounds.size)
    val position = remember(bounds) {
      object : PopupPositionProvider {
        override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize,
          layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
          val x = bounds.center.x.roundToInt() - popupContentSize.width / 2
          val y = if (bounds.top >= popupContentSize.height) bounds.top.roundToInt() - popupContentSize.height
            else bounds.bottom.roundToInt()
          return IntOffset(x.coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0)),
            y.coerceIn(0, (windowSize.height - popupContentSize.height).coerceAtLeast(0)))
        }
      }
    }
    Popup(popupPositionProvider = position, onDismissRequest = { onDone() }) {
      Surface(shape = themedCorners(16), color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.padding(horizontal = 4.dp).testTag("message-selection-toolbar")) {
          SelectionToolbarButton(R.string.assistant_copy, R.drawable.message_copy, "copy") {
            onCopy(selectedText())
            onDone()
          }
          if (state.selection.length < document.length) {
            SelectionToolbarButton(android.R.string.selectAll, R.drawable.message_select_text, "select-all") {
              val all = TextRange(0, document.length)
              state.edit { selection = all }
              initialSelection = all
            }
          }
          SelectionToolbarButton(R.string.conversations_share, R.drawable.message_share, "share") {
            shareMessageText(context, selectedText())
            onDone()
          }
        }
      }
    }
  }
}

@Composable
private fun SelectionToolbarButton(@StringRes label: Int, @DrawableRes icon: Int, id: String, onClick: () -> Unit) {
  TextButton(onClick = onClick, modifier = Modifier.testTag("message-selection-$id")) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(vertical = 4.dp)) {
      Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(18.dp))
      Text(stringResource(label), style = MaterialTheme.typography.labelMedium)
    }
  }
}
