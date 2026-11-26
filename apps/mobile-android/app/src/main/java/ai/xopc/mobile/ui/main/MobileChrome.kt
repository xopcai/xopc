package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.theme.LocalAttentionColors
import ai.xopc.mobile.theme.LocalStatusColors
import ai.xopc.mobile.theme.themedCorners
import android.content.Context
import android.widget.Toast
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** Unified page header with consistent back/sidebar slot, centered title/menu, and trailing actions. */
@Composable
internal fun XopcPageHeader(
  backTag: String,
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
  title: String? = null,
  backEnabled: Boolean = true,
  showBack: Boolean = true,
  leadingContent: (@Composable () -> Unit)? = null,
  titleContent: (@Composable () -> Unit)? = null,
  actions: @Composable RowScope.() -> Unit = {},
) {
  Layout(
    modifier = modifier
      .fillMaxWidth()
      .padding(horizontal = XopcDesignTokens.PagePaddingX, vertical = 8.dp)
      .heightIn(min = XopcDesignTokens.ButtonHeightMd),
    content = {
      Box {
        if (leadingContent != null) {
          leadingContent()
        } else if (showBack) {
          PageBackButton(backTag, onBack, enabled = backEnabled)
        }
      }
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(XopcDesignTokens.ItemGap),
        content = actions,
      )
      Box(Modifier.widthIn(max = 220.dp), contentAlignment = Alignment.Center) {
        if (titleContent != null) {
          titleContent()
        } else if (!title.isNullOrBlank()) {
          Text(
            text = title,
            modifier = Modifier.padding(horizontal = 8.dp),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
          )
        }
      }
    },
  ) { (back, trailing, heading), constraints ->
    val loose = constraints.copy(minWidth = 0, minHeight = 0)
    val backButton = back.measure(loose)
    val actionButtons = trailing.measure(loose.copy(
      maxWidth = if (loose.hasBoundedWidth) loose.maxWidth - backButton.width else Constraints.Infinity,
    ))
    val gap = XopcDesignTokens.ItemGap.roundToPx()
    val startSpace = if (backButton.width > 0) backButton.width + gap else 0
    val endSpace = if (actionButtons.width > 0) actionButtons.width + gap else 0
    val headingMaxWidth = if (loose.hasBoundedWidth) {
      (loose.maxWidth - startSpace - endSpace).coerceAtLeast(0)
    } else {
      Constraints.Infinity
    }
    val titleLayout = heading.measure(loose.copy(maxWidth = headingMaxWidth))
    val width = constraints.constrainWidth(startSpace + titleLayout.width + endSpace)
    val height = constraints.constrainHeight(maxOf(backButton.height, actionButtons.height, titleLayout.height))
    layout(width, height) {
      backButton.placeRelative(0, (height - backButton.height) / 2)
      actionButtons.placeRelative(width - actionButtons.width, (height - actionButtons.height) / 2)
      if (titleLayout.width > 0) {
        val titleStart = ((width - titleLayout.width) / 2)
          .coerceIn(startSpace, width - endSpace - titleLayout.width)
        titleLayout.placeRelative(titleStart, (height - titleLayout.height) / 2)
      }
    }
  }
}

/** Unified bottom sheet applying consistent surface, corners, expansion behavior, and height presets. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun XopcBottomSheet(
  preset: XopcSheetPreset,
  onDismissRequest: () -> Unit,
  modifier: Modifier = Modifier,
  sheetState: SheetState = rememberModalBottomSheetState(
    skipPartiallyExpanded = xopcSheetSkipPartiallyExpanded(preset),
  ),
  containerColor: Color = MaterialTheme.colorScheme.surface,
  dragHandle: (@Composable () -> Unit)? = if (preset == XopcSheetPreset.Immersive) null else ({ BottomSheetDefaults.DragHandle() }),
  content: @Composable ColumnScope.() -> Unit,
) {
  val heightFraction = xopcSheetHeightFraction(preset)
  val sheetModifier = if (preset == XopcSheetPreset.Immersive) {
    modifier.fillMaxHeight(heightFraction)
  } else {
    modifier.layout { measurable, constraints ->
      val limited = if (constraints.hasBoundedHeight) {
        constraints.copy(maxHeight = (constraints.maxHeight * heightFraction).roundToInt()
          .coerceAtLeast(constraints.minHeight))
      } else {
        constraints
      }
      val sheet = measurable.measure(limited)
      layout(sheet.width, sheet.height) { sheet.placeRelative(0, 0) }
    }
  }
  ModalBottomSheet(
    onDismissRequest = onDismissRequest,
    sheetState = sheetState,
    shape = themedCorners(XopcDesignTokens.RadiusLg),
    containerColor = containerColor,
    dragHandle = dragHandle,
    modifier = sheetModifier,
  ) {
    if (preset == XopcSheetPreset.Compact) {
      Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), content = content)
    } else {
      content()
    }
  }
}

/** Unified pull-to-refresh wrapper using the branded Loopi top indicator. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun XopcPullToRefreshBox(
  isRefreshing: Boolean,
  onRefresh: () -> Unit,
  modifier: Modifier = Modifier,
  content: @Composable BoxScope.() -> Unit,
) {
  PullToRefreshBox(
    isRefreshing = isRefreshing,
    onRefresh = onRefresh,
    modifier = modifier,
    indicator = {
      if (isRefreshing) {
        BrandLoadingIndicator(
          modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp),
          extent = 32.dp,
        )
      }
    },
    content = content,
  )
}

/** Unified sheet header: left title (+ optional subtitle), right circular close button. */
@Composable
internal fun XopcSheetHeader(
  title: String,
  onClose: () -> Unit,
  modifier: Modifier = Modifier,
  subtitle: String = "",
  closeTag: String = "sheet-close",
  closeEnabled: Boolean = true,
  trailing: @Composable RowScope.() -> Unit = {},
) {
  Row(
    modifier = modifier
      .fillMaxWidth()
      .padding(horizontal = XopcDesignTokens.SheetPaddingX, vertical = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(XopcDesignTokens.GroupGap),
  ) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Medium,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      if (subtitle.isNotBlank()) {
        Text(
          text = subtitle,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    trailing()
    IconButton(
      onClick = onClose,
      enabled = closeEnabled,
      modifier = Modifier.size(XopcDesignTokens.ButtonHeightMd).testTag(closeTag),
      colors = IconButtonDefaults.iconButtonColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
      ActionIcon(
        R.drawable.action_close,
        size = XopcDesignTokens.IconRow,
        contentDescription = stringResource(R.string.assistant_close),
      )
    }
  }
}

/** Unified confirmation dialog enforcing consistent button hierarchy, destructive danger tint, and haptics. */
@Composable
internal fun XopcConfirmDialog(
  onDismiss: () -> Unit,
  onConfirm: () -> Unit,
  confirmLabel: String,
  title: String? = null,
  message: String? = null,
  cancelLabel: String = stringResource(R.string.progress_cancel),
  destructive: Boolean = false,
  confirmEnabled: Boolean = true,
  confirmTag: String? = null,
  cancelTag: String? = null,
) {
  val haptics = LocalHapticFeedback.current
  AlertDialog(
    onDismissRequest = onDismiss,
    title = title?.let { { Text(it) } },
    text = message?.let { { Text(it) } },
    confirmButton = {
      val buttonModifier = if (confirmTag != null) Modifier.testTag(confirmTag) else Modifier
      TextButton(
        onClick = {
          if (destructive) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
          onConfirm()
        },
        enabled = confirmEnabled,
        modifier = buttonModifier,
      ) {
        Text(
          text = confirmLabel,
          color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
        )
      }
    },
    dismissButton = {
      val buttonModifier = if (cancelTag != null) Modifier.testTag(cancelTag) else Modifier
      TextButton(onClick = onDismiss, modifier = buttonModifier) {
        Text(cancelLabel)
      }
    },
  )
}

/** Unified top-expanded pill search field aligned with HarmonyOS XopcPageSearchField. */
@Composable
internal fun XopcPageSearchField(
  query: String,
  onQueryChange: (String) -> Unit,
  placeholder: String,
  tag: String,
  modifier: Modifier = Modifier,
  maxLength: Int = 160,
  autoFocus: Boolean = true,
  focusRequester: androidx.compose.ui.focus.FocusRequester? = null,
  onSearch: () -> Unit = {},
  trailingAction: (@Composable () -> Unit)? = null,
) {
  val focus = LocalFocusManager.current
  val keyboard = LocalSoftwareKeyboardController.current
  val focusMod = when {
    focusRequester != null -> Modifier.focusRequester(focusRequester)
    autoFocus -> searchInputFocus()
    else -> Modifier
  }
  TextField(
    value = query,
    onValueChange = { onQueryChange(it.take(maxLength)) },
    modifier = modifier.fillMaxWidth().then(focusMod).testTag(tag),
    placeholder = { Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
    shape = CircleShape,
    singleLine = true,
    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    keyboardActions = KeyboardActions(onSearch = {
      focus.clearFocus()
      keyboard?.hide()
      onSearch()
    }),
    colors = TextFieldDefaults.colors(
      focusedIndicatorColor = Color.Transparent,
      unfocusedIndicatorColor = Color.Transparent,
      focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
      unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
    ),
    leadingIcon = { ActionIcon(R.drawable.action_search, size = XopcDesignTokens.IconRow) },
    trailingIcon = {
      if (trailingAction != null) {
        trailingAction()
      } else if (query.isNotEmpty()) {
        IconButton(onClick = { onQueryChange("") }, modifier = Modifier.testTag("$tag-clear")) {
          ActionIcon(
            R.drawable.action_close,
            size = XopcDesignTokens.IconRow,
            contentDescription = stringResource(R.string.assistant_close),
          )
        }
      }
    },
  )
}

/** Unified error panel with calm copy and retry action. */
@Composable
internal fun XopcErrorState(
  message: String,
  retryLabel: String,
  onRetry: () -> Unit,
  modifier: Modifier = Modifier,
  retryEnabled: Boolean = true,
  retryTag: String? = null,
) {
  Column(
    modifier = modifier.fillMaxWidth().padding(24.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(XopcDesignTokens.GroupGap),
  ) {
    Text(
      text = message,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
    )
    val buttonModifier = if (retryTag != null) Modifier.testTag(retryTag) else Modifier
    TextButton(onClick = onRetry, enabled = retryEnabled, modifier = buttonModifier) {
      Text(retryLabel)
    }
  }
}

/** Unified empty state for list views. */
@Composable
internal fun XopcEmptyState(
  message: String,
  modifier: Modifier = Modifier,
  @DrawableRes icon: Int? = null,
  actionLabel: String? = null,
  onAction: (() -> Unit)? = null,
) {
  Column(
    modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(XopcDesignTokens.ItemGap),
  ) {
    if (icon != null) {
      ActionIcon(icon, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 24.dp)
    }
    Text(
      text = message,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
    )
    if (actionLabel != null && onAction != null) {
      TextButton(onClick = onAction) {
        Text(actionLabel)
      }
    }
  }
}

@Composable
internal fun rememberSkeletonAlpha(): Float {
  val motionAllowed = rememberMotionAllowed()
  if (!motionAllowed) return 0.72f
  val transition = rememberInfiniteTransition(label = "xopc-list-skeleton")
  val animated by transition.animateFloat(
    initialValue = 0.45f,
    targetValue = 0.90f,
    animationSpec = infiniteRepeatable(
      animation = tween(XopcMotionTokens.SkeletonMs, easing = LinearEasing),
      repeatMode = RepeatMode.Reverse,
    ),
    label = "xopc-skeleton-alpha",
  )
  return animated
}

/** Unified pulsing list skeleton honoring system reduce-motion settings. */
@Composable
internal fun XopcListSkeleton(
  modifier: Modifier = Modifier,
  rows: Int = 3,
) {
  val alpha = rememberSkeletonAlpha()
  val loadingLabel = stringResource(R.string.brand_loading)
  val barColor = MaterialTheme.colorScheme.surfaceContainer
  Column(
    modifier = modifier
      .fillMaxWidth()
      .padding(vertical = 12.dp)
      .alpha(alpha)
      .semantics { contentDescription = loadingLabel },
    verticalArrangement = Arrangement.spacedBy(18.dp),
  ) {
    repeat(rows) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(XopcDesignTokens.GroupGap),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Box(Modifier.size(28.dp).clip(themedCorners(6)).background(barColor))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Box(Modifier.fillMaxWidth(0.75f).height(16.dp).clip(themedCorners(4)).background(barColor))
          Box(Modifier.fillMaxWidth(0.50f).height(12.dp).clip(themedCorners(4)).background(barColor))
        }
      }
    }
  }
}

internal enum class XopcBannerTone { Info, Warning, Danger, Success }

/** Unified inline feedback banner for errors, warnings, partial loads, and tips. */
@Composable
internal fun XopcInlineBanner(
  message: String,
  modifier: Modifier = Modifier,
  tone: XopcBannerTone = XopcBannerTone.Info,
  actionLabel: String? = null,
  onAction: (() -> Unit)? = null,
  actionEnabled: Boolean = true,
  actionTag: String? = null,
) {
  val colors = MaterialTheme.colorScheme
  val attention = LocalAttentionColors.current
  val status = LocalStatusColors.current
  val (containerColor, contentColor) = when (tone) {
    XopcBannerTone.Info -> colors.surfaceContainerLow to colors.onSurfaceVariant
    XopcBannerTone.Warning -> attention.fill to attention.foreground
    XopcBannerTone.Danger -> status.dangerSoft to colors.error
    XopcBannerTone.Success -> status.successSoft to status.success
  }
  Row(
    modifier = modifier
      .fillMaxWidth()
      .clip(themedCorners(XopcDesignTokens.RadiusSm))
      .background(containerColor)
      .padding(horizontal = 14.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(XopcDesignTokens.ItemGap),
  ) {
    Text(
      text = message,
      modifier = Modifier.weight(1f),
      style = MaterialTheme.typography.bodySmall,
      color = contentColor,
      maxLines = 3,
      overflow = TextOverflow.Ellipsis,
    )
    if (actionLabel != null && onAction != null) {
      val btnMod = if (actionTag != null) Modifier.testTag(actionTag) else Modifier
      TextButton(onClick = onAction, enabled = actionEnabled, modifier = btnMod) {
        Text(actionLabel, color = if (tone == XopcBannerTone.Danger) colors.error else colors.primary)
      }
    }
  }
}

/** Unified floating undo bar for soft-delete and trash actions. */
@Composable
internal fun XopcUndoBar(
  message: String,
  undoLabel: String,
  onUndo: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  undoTag: String? = null,
) {
  val colors = MaterialTheme.colorScheme
  Row(
    modifier = modifier
      .fillMaxWidth()
      .clip(themedCorners(XopcDesignTokens.RadiusMd))
      .background(colors.surfaceContainerHigh)
      .padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(XopcDesignTokens.ItemGap),
  ) {
    Text(
      text = message,
      modifier = Modifier.weight(1f),
      style = MaterialTheme.typography.bodyMedium,
      color = colors.onSurface,
      maxLines = 2,
      overflow = TextOverflow.Ellipsis,
    )
    val btnMod = if (undoTag != null) Modifier.testTag(undoTag) else Modifier
    TextButton(onClick = onUndo, enabled = enabled, modifier = btnMod) {
      Text(undoLabel, color = colors.primary, fontWeight = FontWeight.Medium)
    }
  }
}

internal data class XopcBatchAction(
  val label: String,
  val onClick: () -> Unit,
  val enabled: Boolean = true,
  val destructive: Boolean = false,
  val tag: String? = null,
)

/** Unified batch-selection bottom/inline action bar. */
@Composable
internal fun XopcBatchActionBar(
  actions: List<XopcBatchAction>,
  modifier: Modifier = Modifier,
) {
  val colors = MaterialTheme.colorScheme
  Row(
    modifier = modifier
      .fillMaxWidth()
      .clip(themedCorners(XopcDesignTokens.RadiusMd))
      .background(colors.surfaceContainerLow)
      .padding(horizontal = 4.dp, vertical = 2.dp),
    horizontalArrangement = Arrangement.SpaceEvenly,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    actions.forEach { action ->
      val btnMod = if (action.tag != null) Modifier.testTag(action.tag) else Modifier
      TextButton(
        onClick = action.onClick,
        enabled = action.enabled,
        modifier = btnMod.heightIn(min = XopcDesignTokens.ButtonHeightMd),
      ) {
        Text(
          text = action.label,
          color = if (action.destructive) colors.error else colors.onSurface,
        )
      }
    }
  }
}

internal enum class XopcButtonVariant { Primary, Secondary, Ghost, Danger, Tonal }
internal enum class XopcButtonSize { Sm, Md, Lg }

/** Unified button hierarchy aligned with three-platform Calm Intelligence spec. */
@Composable
internal fun XopcButton(
  label: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  variant: XopcButtonVariant = XopcButtonVariant.Primary,
  size: XopcButtonSize = XopcButtonSize.Md,
  enabled: Boolean = true,
) {
  val colors = MaterialTheme.colorScheme
  val status = LocalStatusColors.current
  val minHeight = when (size) {
    XopcButtonSize.Sm -> XopcDesignTokens.ButtonHeightSm
    XopcButtonSize.Md -> XopcDesignTokens.ButtonHeightMd
    XopcButtonSize.Lg -> XopcDesignTokens.ButtonHeightLg
  }
  val shape = themedCorners(XopcDesignTokens.RadiusSm)
  val contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp)
  when (variant) {
    XopcButtonVariant.Primary -> Button(
      onClick = onClick,
      enabled = enabled,
      modifier = modifier.heightIn(min = minHeight),
      shape = shape,
      contentPadding = contentPadding,
      colors = ButtonDefaults.buttonColors(containerColor = colors.primary, contentColor = colors.onPrimary),
    ) { Text(label) }
    XopcButtonVariant.Secondary -> FilledTonalButton(
      onClick = onClick,
      enabled = enabled,
      modifier = modifier.heightIn(min = minHeight),
      shape = shape,
      contentPadding = contentPadding,
      colors = ButtonDefaults.filledTonalButtonColors(
        containerColor = colors.surfaceContainer,
        contentColor = colors.onSurface,
      ),
    ) { Text(label) }
    XopcButtonVariant.Tonal -> FilledTonalButton(
      onClick = onClick,
      enabled = enabled,
      modifier = modifier.heightIn(min = minHeight),
      shape = shape,
      contentPadding = contentPadding,
      colors = ButtonDefaults.filledTonalButtonColors(
        containerColor = colors.primaryContainer,
        contentColor = colors.primary,
      ),
    ) { Text(label) }
    XopcButtonVariant.Danger -> FilledTonalButton(
      onClick = onClick,
      enabled = enabled,
      modifier = modifier.heightIn(min = minHeight),
      shape = shape,
      contentPadding = contentPadding,
      colors = ButtonDefaults.filledTonalButtonColors(
        containerColor = status.dangerSoft,
        contentColor = colors.error,
      ),
    ) { Text(label) }
    XopcButtonVariant.Ghost -> TextButton(
      onClick = onClick,
      enabled = enabled,
      modifier = modifier.heightIn(min = minHeight),
      shape = shape,
      contentPadding = contentPadding,
    ) { Text(label) }
  }
}

/** Unified borderless layered card surface. */
@Composable
internal fun XopcCard(
  modifier: Modifier = Modifier,
  containerColor: Color = MaterialTheme.colorScheme.surfaceContainerLow,
  onClick: (() -> Unit)? = null,
  enabled: Boolean = true,
  content: @Composable ColumnScope.() -> Unit,
) {
  val shape = themedCorners(XopcDesignTokens.RadiusMd)
  if (onClick != null) {
    Surface(
      onClick = onClick,
      enabled = enabled,
      modifier = modifier.fillMaxWidth(),
      shape = shape,
      color = containerColor,
    ) {
      Column(Modifier.padding(XopcDesignTokens.CardPadding), content = content)
    }
  } else {
    Surface(
      modifier = modifier.fillMaxWidth(),
      shape = shape,
      color = containerColor,
    ) {
      Column(Modifier.padding(XopcDesignTokens.CardPadding), content = content)
    }
  }
}

/** Unified semantic status pill badge. */
@Composable
internal fun XopcBadge(
  label: String,
  modifier: Modifier = Modifier,
  tone: XopcBannerTone = XopcBannerTone.Info,
) {
  val colors = MaterialTheme.colorScheme
  val attention = LocalAttentionColors.current
  val status = LocalStatusColors.current
  val (bg, fg) = when (tone) {
    XopcBannerTone.Info -> colors.primaryContainer to colors.primary
    XopcBannerTone.Warning -> attention.fill to attention.foreground
    XopcBannerTone.Danger -> status.dangerSoft to colors.error
    XopcBannerTone.Success -> status.successSoft to status.success
  }
  Surface(modifier = modifier, shape = CircleShape, color = bg) {
    Text(
      text = label,
      style = MaterialTheme.typography.labelSmall,
      fontWeight = FontWeight.Medium,
      color = fg,
      modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
    )
  }
}

/** Centralized short toast helper to avoid scattered Toast.makeText calls. */
internal fun xopcShowToast(context: Context, @StringRes messageRes: Int) {
  Toast.makeText(context, messageRes, Toast.LENGTH_SHORT).show()
}

internal fun xopcShowToast(context: Context, message: String) {
  Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
}
