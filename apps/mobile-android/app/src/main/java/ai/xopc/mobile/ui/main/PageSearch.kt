package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
internal fun PageBackButton(tag: String, onClick: () -> Unit) {
  IconButton(onClick = onClick, modifier = Modifier.size(48.dp).testTag(tag)) {
    ActionIcon(R.drawable.action_chevron_left, contentDescription = stringResource(R.string.progress_back))
  }
}

@Composable
internal fun PageSearchButton(open: Boolean, @StringRes label: Int, tag: String, onClick: () -> Unit) {
  val focusManager = LocalFocusManager.current
  val keyboard = LocalSoftwareKeyboardController.current
  IconButton(onClick = {
    if (open) {
      focusManager.clearFocus(force = true)
      keyboard?.hide()
    }
    onClick()
  }, modifier = Modifier.size(48.dp).testTag(if (open) "$tag-close" else tag)) {
    ActionIcon(if (open) R.drawable.action_close else R.drawable.action_search, size = 24.dp,
      contentDescription = stringResource(if (open) R.string.assistant_close else label))
  }
}

@Composable
internal fun searchInputFocus(): Modifier {
  val requester = remember { FocusRequester() }
  LaunchedEffect(requester) { requester.requestFocus() }
  return Modifier.focusRequester(requester)
}
