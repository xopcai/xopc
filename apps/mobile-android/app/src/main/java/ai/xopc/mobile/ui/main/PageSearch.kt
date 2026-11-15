package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
internal fun PageBackButton(tag: String, onClick: () -> Unit, enabled: Boolean = true) {
  IconButton(onClick = onClick, modifier = Modifier.size(44.dp).testTag(tag), enabled = enabled,
    colors = IconButtonDefaults.iconButtonColors(containerColor = MaterialTheme.colorScheme.surface)) {
    ActionIcon(R.drawable.action_back, contentDescription = stringResource(R.string.progress_back))
  }
}

@Composable
internal fun <T> PageTitleMenu(options: List<SegmentOption<T>>, selected: T, tag: String,
  modifier: Modifier = Modifier, onSelect: (T) -> Unit) {
  var expanded by remember { mutableStateOf(false) }
  val title = options.firstOrNull { it.value == selected }?.label.orEmpty()
  Box(modifier, contentAlignment = Alignment.Center) {
    TextButton(onClick = { expanded = true }, modifier = Modifier.heightIn(min = 44.dp).testTag(tag)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.titleMedium,
          color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
        ActionIcon(R.drawable.action_chevron_down, size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, modifier = Modifier.widthIn(min = 192.dp),
      shape = RoundedCornerShape(22.dp), containerColor = MaterialTheme.colorScheme.surfaceContainerHigh) {
      options.forEach { option ->
        val current = option.value == selected
        DropdownMenuItem(text = { Text(option.label) },
          trailingIcon = if (current) ({ Text("✓", style = MaterialTheme.typography.titleMedium) }) else null,
          modifier = Modifier.testTag(option.tag).semantics { this.selected = current },
          onClick = { expanded = false; onSelect(option.value) })
      }
    }
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
