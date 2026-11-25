package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.theme.LocalAttentionColors
import ai.xopc.mobile.theme.LocalChatColors
import ai.xopc.mobile.gateway.ConversationSummary
import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.BiasAbsoluteAlignment
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.abs

internal fun Modifier.horizontalSwipe(
  enabled: Boolean = true, leftGestureEdge: Int = 0, rightGestureEdge: Int = 0,
  allowLeft: Boolean = true, allowRight: Boolean = true,
  onDrag: (Float) -> Unit = {}, onRelease: (Float, Float) -> Unit, onCancel: () -> Unit = {},
): Modifier = if (!enabled) this else composed {
  val currentDrag by rememberUpdatedState(onDrag)
  val currentRelease by rememberUpdatedState(onRelease)
  val currentCancel by rememberUpdatedState(onCancel)
  pointerInput(leftGestureEdge, rightGestureEdge, allowLeft, allowRight) {
    awaitEachGesture {
      val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
      if (down.position.x < leftGestureEdge || down.position.x > size.width - rightGestureEdge) return@awaitEachGesture
      val tracker = VelocityTracker()
      tracker.addPosition(down.uptimeMillis, down.position)
      var dragging = false
      try {
        while (true) {
          val event = awaitPointerEvent(PointerEventPass.Initial)
          val change = event.changes.firstOrNull { it.id == down.id } ?: break
          if (change.isConsumed || event.changes.count { it.pressed } > 1) break
          tracker.addPosition(change.uptimeMillis, change.position)
          val offset = change.position - down.position
          if (!change.pressed) {
            if (dragging) {
              dragging = false
              change.consume()
              currentRelease(offset.x, tracker.calculateVelocity().x)
            }
            break
          }
          if (!dragging) {
            if (abs(offset.y) > viewConfiguration.touchSlop && abs(offset.y) >= abs(offset.x)) break
            if (abs(offset.x) < viewConfiguration.touchSlop || abs(offset.x) < abs(offset.y) * 1.25f) continue
            if (offset.x < 0f && !allowLeft || offset.x > 0f && !allowRight) break
            dragging = true
          }
          change.consume()
          currentDrag(offset.x)
        }
      } finally {
        if (dragging) currentCancel()
      }
    }
  }
}

@Stable
internal class ChatSidebarState {
  var open by mutableStateOf(false)
  var dragFraction by mutableStateOf<Float?>(null)
  val settled = Animatable(0f)
  val visible: Boolean get() = open || dragFraction != null || settled.value > 0f
  val progress: Float get() = dragFraction ?: settled.value
}

@Composable
internal fun ChatSidebar(state: ChatSidebarState, width: Dp, connection: ConnectionUiState,
  onClose: () -> Unit, onRetry: () -> Unit, onLoadMore: () -> Unit,
  onDestination: (HomeTab) -> Unit, onPersonal: () -> Unit,
  onNew: () -> Unit, onConversation: (String) -> Unit, onSearch: () -> Unit,
  onRename: (String) -> Unit, onTogglePin: (String) -> Unit, onDelete: (List<String>) -> Unit) {
  val motionAllowed = rememberMotionAllowed()
  LaunchedEffect(state.open, state.dragFraction != null, motionAllowed) {
    val fraction = state.dragFraction
    if (fraction != null) return@LaunchedEffect
    val target = if (state.open) 1f else 0f
    val duration = xopcMotionDuration(XopcMotionTokens.StandardMs, motionAllowed)
    if (duration == 0) state.settled.snapTo(target)
    else state.settled.animateTo(target, tween(duration, easing = XopcMotionTokens.StandardEasing))
  }
  if (!state.visible) return
  var menuId by remember { mutableStateOf<String?>(null) }
  var selecting by remember { mutableStateOf(false) }
  var selectedIds by remember { mutableStateOf(emptySet<String>()) }
  var deleteTargets by remember { mutableStateOf(emptyList<String>()) }
  var submittedRevision by remember { mutableStateOf<Int?>(null) }
  var deleteFailureCount by remember { mutableIntStateOf(0) }
  fun cancelSelection() {
    selecting = false
    selectedIds = emptySet()
    deleteFailureCount = 0
  }
  LaunchedEffect(state.open) {
    if (!state.open) {
      menuId = null
      deleteTargets = emptyList()
      cancelSelection()
    }
  }
  LaunchedEffect(connection.batchConversationRevision) {
    if (submittedRevision?.let { it != connection.batchConversationRevision } == true) {
      submittedRevision = null
      if (selecting) {
        selectedIds = connection.batchConversationFailedIds.toSet()
        selecting = selectedIds.isNotEmpty()
      }
      deleteFailureCount = connection.batchConversationFailedIds.size
    }
  }
  val operationBusy = connection.batchConversationBusy || connection.renamingConversation ||
    connection.pinningConversationId != null || connection.archivingConversationId != null ||
    connection.renameDraftId != null
  fun canDelete(ids: Collection<String>): Boolean = ids.isNotEmpty() && !operationBusy &&
    !connection.sending && connection.pendingDeleteId == null && !connection.deleteCommitting &&
    (connection.selectedConversationId !in ids || (connection.activeRunId == null && connection.pendingInput == null))
  val close: () -> Unit = {
    if (!operationBusy) {
      if (selecting) cancelSelection() else onClose()
    }
  }
  BackHandler(enabled = state.open, onBack = close)
  if (deleteTargets.isNotEmpty()) XopcConfirmDialog(
    onDismiss = { deleteTargets = emptyList() },
    onConfirm = {
      val targets = deleteTargets
      deleteTargets = emptyList()
      deleteFailureCount = 0
      submittedRevision = connection.batchConversationRevision
      onDelete(targets)
    },
    title = stringResource(R.string.conversations_delete),
    message = if (deleteTargets.size == 1) stringResource(R.string.conversations_delete_one_confirm)
      else stringResource(R.string.conversations_batch_delete_confirm, deleteTargets.size),
    confirmLabel = stringResource(R.string.conversations_delete),
    cancelLabel = stringResource(R.string.conversations_cancel),
    destructive = true,
    confirmEnabled = canDelete(deleteTargets),
    confirmTag = "chat-sidebar-delete-confirm",
  )
  val scheme = MaterialTheme.colorScheme
  val dismissLabel = stringResource(R.string.assistant_close)
  val density = LocalDensity.current
  val widthPx = with(density) { width.toPx() }
  val closeDistance = with(density) { 96.dp.toPx() }
  val flickDistance = with(density) { 24.dp.toPx() }
  val flickVelocity = with(density) { 550.dp.toPx() }
  val scope = rememberCoroutineScope()
  val settleDrag: (Boolean) -> Unit = { close ->
    state.dragFraction?.let { fraction ->
      scope.launch {
        state.settled.snapTo(fraction)
        if (close) onClose()
        state.dragFraction = null
      }
    }
  }
  Box(Modifier.fillMaxSize().horizontalSwipe(enabled = state.open && !selecting && !operationBusy && widthPx > 0f, allowRight = false,
    onDrag = { state.dragFraction = (1f + it / widthPx).coerceIn(0f, 1f) },
    onRelease = { distance, speed ->
      settleDrag(-distance >= minOf(widthPx * 0.32f, closeDistance) ||
        -distance >= flickDistance && -speed >= flickVelocity)
    },
    onCancel = { settleDrag(false) },
  )) {
    Box(Modifier.matchParentSize().graphicsLayer { alpha = state.progress }
      .background(Color.Black.copy(alpha = 0.40f))
      .then(if (state.open) Modifier.clickable(role = Role.Button, onClick = close)
        .semantics { contentDescription = dismissLabel }.testTag("chat-sidebar-scrim") else Modifier))
    Column(Modifier.align(BiasAbsoluteAlignment(-1f, 0f)).width(width).fillMaxHeight()
      .graphicsLayer { translationX = (state.progress - 1f) * size.width }
      .background(scheme.surface)
      .then(if (state.open) Modifier.pointerInput(Unit) {
        awaitPointerEventScope { while (true) awaitPointerEvent() }
      } else Modifier.semantics { hideFromAccessibility() })
      .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical))
      .padding(horizontal = 14.dp).testTag("chat-sidebar")) {
      Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 6.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (selecting) {
          Text(stringResource(R.string.conversations_selected, selectedIds.size), Modifier.weight(1f),
            style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        } else {
          val mark = if (scheme.surface.luminance() < 0.2f) R.drawable.sidebar_brand_dark else R.drawable.sidebar_brand_light
          Icon(painterResource(mark), null, Modifier.size(27.dp), tint = Color.Unspecified)
          Text("xopc", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold, color = scheme.onSurface)
        }
        IconButton(onClick = close, enabled = !operationBusy, modifier = Modifier.testTag("chat-sidebar-close")
          .background(scheme.surfaceContainer, CircleShape)) {
          Icon(painterResource(R.drawable.action_close),
            if (selecting) stringResource(R.string.conversations_cancel) else dismissLabel,
            Modifier.size(22.dp), tint = scheme.onSurface)
        }
      }
      if (connection.pinActionError || deleteFailureCount > 0) Text(
        when {
          deleteFailureCount == 0 -> stringResource(R.string.conversations_pin_error)
          selecting -> stringResource(R.string.conversations_batch_failed, deleteFailureCount)
          else -> stringResource(R.string.conversations_delete_one_error)
        },
        Modifier.padding(horizontal = 10.dp, vertical = 4.dp), color = scheme.error,
        style = MaterialTheme.typography.bodySmall)
      val personal = connection.personal.agent
      val attention = connection.progress.needsUser.size.takeIf {
        connection.progress.gatewayId == connection.profile?.gatewayId
      } ?: 0
      val recent = remember(connection.recentConversations, personal?.conversationId, connection.pendingDeleteId) {
        connection.recentConversations.orEmpty().filter {
          it.id != personal?.conversationId && it.id != connection.pendingDeleteId && it.isRecentSidebarCandidate
        }.sortedWith(compareByDescending<ConversationSummary> { it.status == "pinned" }.thenByDescending { it.updatedAt })
      }
      val shortcutsEnabled = !selecting && !operationBusy
      val nextOffset = connection.recentConversationsNextOffset
      val requestMore by rememberUpdatedState(onLoadMore)
      LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("chat-sidebar-list"),
        verticalArrangement = Arrangement.spacedBy(2.dp), contentPadding = PaddingValues(bottom = 8.dp)) {
        item("search") {
          SidebarRow(R.string.conversations_search, R.drawable.action_search, "chat-sidebar-search",
            Modifier.padding(bottom = 4.dp).clip(MaterialTheme.shapes.large).background(scheme.surfaceContainer),
            enabled = shortcutsEnabled, onClick = onSearch)
        }
        item("personal") {
          SidebarRow(personal?.displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.personal_agent_title),
            "chat-sidebar-personal",
            Modifier.clip(MaterialTheme.shapes.medium)
              .background(if (personal != null && personal.conversationId == connection.selectedConversationId)
                scheme.surfaceContainerHigh else Color.Transparent),
            badge = connection.personal.unreadCount, unreadBadge = true,
            enabled = shortcutsEnabled && !connection.personal.agentCreating, onClick = onPersonal) {
            PersonalAgentAvatar(connection.personal.agentAvatar, personal?.appearance ?: "loopi", 24.dp, active = false)
          }
        }
        item("workbench") {
          SidebarRow(R.string.tab_workbench, R.drawable.tab_progress, "chat-sidebar-workbench", badge = attention, enabled = shortcutsEnabled) {
            onDestination(HomeTab.Progress)
          }
        }
        item("automations") {
          SidebarRow(R.string.progress_automations, R.drawable.action_clock, "chat-sidebar-automations", enabled = shortcutsEnabled) {
            onDestination(HomeTab.Automations)
          }
        }
        item("notes") {
          SidebarRow(R.string.tab_notes, R.drawable.tab_notes, "chat-sidebar-notes", enabled = shortcutsEnabled) { onDestination(HomeTab.Notes) }
        }
        item("library") {
          SidebarRow(R.string.library_title, R.drawable.action_folder, "chat-sidebar-library", enabled = shortcutsEnabled) { onDestination(HomeTab.Library) }
        }
        item("capabilities") {
          SidebarRow(R.string.capability_title, R.drawable.action_capabilities, "chat-sidebar-capabilities", enabled = shortcutsEnabled) {
            onDestination(HomeTab.Capabilities)
          }
        }
        items(recent, key = { "conversation-${it.id}" }) { item ->
          SidebarConversationRow(item, selecting,
            selected = if (selecting) item.id in selectedIds else item.id == connection.selectedConversationId,
            enabled = !operationBusy, menuOpen = menuId == item.id, canDelete = canDelete(listOf(item.id)),
            onOpenMenu = { menuId = item.id }, onDismissMenu = { menuId = null },
            onClick = {
              if (!selecting) onConversation(item.id)
              else selectedIds = if (item.id in selectedIds) selectedIds - item.id else selectedIds + item.id
            },
            onRename = { onRename(item.id) }, onTogglePin = { onTogglePin(item.id) },
            onStartSelection = { selectedIds = setOf(item.id); selecting = true; deleteFailureCount = 0 },
            onDelete = { deleteTargets = listOf(item.id) })
        }
        if (connection.recentConversationsLoading) {
          item("loading") { BrandLoadingIndicator(Modifier.padding(10.dp), extent = 24.dp) }
        } else if (connection.recentConversationsError) {
          item("retry") {
            Row(Modifier.fillMaxWidth().padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
              Text(stringResource(R.string.chat_load_error), Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
              TextButton(onClick = if (nextOffset == null) onRetry else onLoadMore,
                modifier = Modifier.testTag("chat-sidebar-retry")) {
                Text(stringResource(R.string.progress_refresh))
              }
            }
          }
        } else if (nextOffset != null) {
          item("load-more") {
            Spacer(Modifier.height(32.dp))
            LaunchedEffect(nextOffset, state.open) {
              if (state.open) requestMore()
            }
          }
        }
      }
      if (selecting) {
        TextButton(onClick = { deleteTargets = selectedIds.toList() }, enabled = canDelete(selectedIds),
          colors = ButtonDefaults.textButtonColors(contentColor = scheme.error),
          modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).heightIn(min = 46.dp)
            .testTag("chat-sidebar-batch-delete")) {
          Icon(painterResource(R.drawable.action_delete), null, Modifier.size(20.dp))
          Spacer(Modifier.width(8.dp))
          Text(stringResource(R.string.conversations_delete))
        }
      } else {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
          Button(onClick = onNew, enabled = shortcutsEnabled && !connection.creatingConversation,
            colors = ButtonDefaults.buttonColors(containerColor = LocalChatColors.current.action,
              contentColor = LocalChatColors.current.onAction),
            modifier = Modifier.heightIn(min = 46.dp).testTag("chat-sidebar-new")) {
            Icon(painterResource(R.drawable.action_new_chat), null, Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.assistant_action_new_chat))
          }
          Spacer(Modifier.weight(1f))
          IconButton(onClick = { onDestination(HomeTab.Me) }, enabled = shortcutsEnabled, modifier = Modifier
            .background(scheme.surfaceContainer, CircleShape).testTag("chat-sidebar-profile")) {
            Icon(painterResource(R.drawable.action_settings), stringResource(R.string.settings_title), Modifier.size(22.dp),
              tint = scheme.onSurface)
          }
        }
      }
    }
  }
}

@Composable
private fun SidebarConversationRow(item: ConversationSummary, selecting: Boolean, selected: Boolean, enabled: Boolean,
  menuOpen: Boolean, canDelete: Boolean, onOpenMenu: () -> Unit, onDismissMenu: () -> Unit,
  onClick: () -> Unit, onRename: () -> Unit, onTogglePin: () -> Unit, onStartSelection: () -> Unit, onDelete: () -> Unit) {
  val scheme = MaterialTheme.colorScheme
  val pinned = item.status == "pinned"
  val menuLabel = stringResource(R.string.conversations_more_actions)
  Box(Modifier.fillMaxWidth()) {
    Row(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small)
      .background(if (selected) scheme.surfaceContainerHigh else Color.Transparent)
      .combinedClickable(enabled = enabled, role = Role.Button, onClick = onClick,
        onLongClickLabel = menuLabel.takeUnless { selecting }, onLongClick = onOpenMenu.takeUnless { selecting })
      .heightIn(min = 46.dp).padding(horizontal = 10.dp, vertical = 10.dp)
      .semantics { this.selected = selected }.testTag("chat-sidebar-session-${item.id}"),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      if (selecting) Checkbox(checked = selected, onCheckedChange = null, enabled = enabled,
        modifier = Modifier.size(22.dp))
      Text(item.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
        style = MaterialTheme.typography.bodyLarge, color = scheme.onSurface)
      if (pinned) Icon(painterResource(R.drawable.action_pin), stringResource(R.string.conversations_pinned),
        Modifier.size(16.dp), tint = scheme.onSurfaceVariant)
    }
    if (menuOpen) Box(Modifier.align(Alignment.CenterEnd)) {
      DropdownMenu(expanded = true, onDismissRequest = onDismissMenu, offset = DpOffset(0.dp, 24.dp),
        modifier = Modifier.width(200.dp).testTag("chat-sidebar-session-menu")) {
        SidebarMenuItem(R.string.conversations_rename, R.drawable.action_new_chat, "rename") {
          onDismissMenu(); onRename()
        }
        HorizontalDivider()
        SidebarMenuItem(if (pinned) R.string.conversations_unpin else R.string.conversations_pin,
          R.drawable.action_pin, "pin") { onDismissMenu(); onTogglePin() }
        HorizontalDivider()
        SidebarMenuItem(R.string.conversations_multi_select, R.drawable.action_task_list, "select") {
          onDismissMenu(); onStartSelection()
        }
        HorizontalDivider()
        SidebarMenuItem(R.string.conversations_delete, R.drawable.action_delete, "delete",
          enabled = canDelete, destructive = true) { onDismissMenu(); onDelete() }
      }
    }
  }
}

@Composable
private fun SidebarMenuItem(@StringRes label: Int, @DrawableRes icon: Int, tag: String,
  enabled: Boolean = true, destructive: Boolean = false, onClick: () -> Unit) {
  val colors = if (destructive) MenuDefaults.itemColors(
    textColor = MaterialTheme.colorScheme.error, leadingIconColor = MaterialTheme.colorScheme.error)
    else MenuDefaults.itemColors()
  DropdownMenuItem(text = { Text(stringResource(label)) }, leadingIcon = {
    Icon(painterResource(icon), null, Modifier.size(20.dp))
  }, enabled = enabled, colors = colors, onClick = onClick, modifier = Modifier.testTag("chat-sidebar-menu-$tag"))
}

@Composable
private fun SidebarRow(@StringRes label: Int, @DrawableRes icon: Int, tag: String,
  modifier: Modifier = Modifier, badge: Int = 0, enabled: Boolean = true, onClick: () -> Unit) {
  SidebarRow(stringResource(label), tag, modifier, badge, enabled, onClick = onClick) {
    Icon(painterResource(icon), null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun SidebarRow(label: String, tag: String, modifier: Modifier = Modifier, badge: Int = 0,
  enabled: Boolean = true, unreadBadge: Boolean = false, onClick: () -> Unit, icon: @Composable () -> Unit) {
  Row(modifier.fillMaxWidth().heightIn(min = 46.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
    .padding(horizontal = 10.dp).testTag(tag), verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { icon() }
    Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge,
      maxLines = 1, overflow = TextOverflow.Ellipsis,
      color = MaterialTheme.colorScheme.onSurface)
    if (badge > 0) {
      val fill = if (unreadBadge) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
        else LocalAttentionColors.current.fill
      val foreground = if (unreadBadge) MaterialTheme.colorScheme.primary else LocalAttentionColors.current.foreground
      val accessibility = if (unreadBadge) {
        val unreadLabel = pluralStringResource(R.plurals.personal_unread_messages, badge, badge)
        Modifier.semantics { contentDescription = unreadLabel }.testTag("personal-unread-badge")
      } else Modifier.testTag("progress-attention-badge")
      Text(if (badge > 99) "99+" else badge.toString(),
        Modifier.background(fill, CircleShape).padding(horizontal = 8.dp, vertical = 4.dp).then(accessibility),
        color = foreground, style = MaterialTheme.typography.labelMedium)
    }
  }
}
