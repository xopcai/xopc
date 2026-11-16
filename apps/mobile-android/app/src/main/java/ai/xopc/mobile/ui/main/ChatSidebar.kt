package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.theme.LocalAttentionColors
import ai.xopc.mobile.theme.LocalChatColors
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
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
  onClose: () -> Unit, onRetry: () -> Unit, onDestination: (HomeTab) -> Unit, onPersonal: () -> Unit,
  onNew: () -> Unit, onConversation: (String) -> Unit, onSearch: () -> Unit) {
  LaunchedEffect(state.open, state.dragFraction != null) {
    val fraction = state.dragFraction
    if (fraction != null) return@LaunchedEffect
    state.settled.animateTo(if (state.open) 1f else 0f, tween(210))
  }
  if (!state.visible) return
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
  Box(Modifier.fillMaxSize().horizontalSwipe(enabled = state.open && widthPx > 0f, allowRight = false,
    onDrag = { state.dragFraction = (1f + it / widthPx).coerceIn(0f, 1f) },
    onRelease = { distance, speed ->
      settleDrag(-distance >= minOf(widthPx * 0.32f, closeDistance) ||
        -distance >= flickDistance && -speed >= flickVelocity)
    },
    onCancel = { settleDrag(false) },
  )) {
    Box(Modifier.matchParentSize().graphicsLayer { alpha = state.progress }
      .background(Color.Black.copy(alpha = 0.40f))
      .then(if (state.open) Modifier.clickable(role = Role.Button, onClick = onClose)
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
        val mark = if (scheme.surface.luminance() < 0.2f) R.drawable.sidebar_brand_dark else R.drawable.sidebar_brand_light
        Icon(painterResource(mark), null, Modifier.size(27.dp), tint = Color.Unspecified)
        Text("xopc", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge,
          fontWeight = FontWeight.Bold, color = scheme.onSurface)
        IconButton(onClick = onClose, modifier = Modifier.testTag("chat-sidebar-close")
          .background(scheme.surfaceContainer, CircleShape)) {
          Icon(painterResource(R.drawable.action_close), dismissLabel, Modifier.size(22.dp), tint = scheme.onSurface)
        }
      }
      SidebarRow(R.string.conversations_search, R.drawable.action_search, "chat-sidebar-search",
        Modifier.clip(MaterialTheme.shapes.large).background(scheme.surfaceContainer), onClick = onSearch)
      Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = 12.dp, bottom = 8.dp)) {
        val personal = connection.personal.agent
        SidebarRow(personal?.displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.personal_agent_title),
          "chat-sidebar-personal",
          Modifier.clip(MaterialTheme.shapes.medium)
            .background(if (personal != null && personal.conversationId == connection.selectedConversationId)
              scheme.surfaceContainerHigh else Color.Transparent),
          enabled = !connection.personal.agentCreating, onClick = onPersonal) {
          PersonalAgentAvatar(connection.personal.agentAvatar, personal?.appearance ?: "loopi", 22.dp, active = false)
        }
        val attention = connection.progress.needsUser.size.takeIf {
          connection.progress.gatewayId == connection.profile?.gatewayId
        } ?: 0
        SidebarRow(R.string.tab_progress, R.drawable.tab_progress, "chat-sidebar-progress", badge = attention) {
          onDestination(HomeTab.Progress)
        }
        SidebarRow(R.string.progress_projects, R.drawable.action_folder, "chat-sidebar-projects") {
          onDestination(HomeTab.Projects)
        }
        SidebarRow(R.string.progress_automations, R.drawable.action_clock, "chat-sidebar-automations") {
          onDestination(HomeTab.Automations)
        }
        SidebarRow(R.string.library_title, R.drawable.tab_notes, "chat-sidebar-library") {
          onDestination(HomeTab.Notes)
        }
        SidebarRow(R.string.capability_title, R.drawable.action_capabilities, "chat-sidebar-capabilities") {
          onDestination(HomeTab.Capabilities)
        }
        Text(stringResource(R.string.chat_recent_conversations),
          Modifier.padding(start = 10.dp, top = 16.dp, bottom = 4.dp), style = MaterialTheme.typography.labelMedium,
          color = scheme.onSurfaceVariant)
        val rows = connection.recentConversations ?: connection.conversations
          .takeIf { connection.conversationResultsQuery.isEmpty() }.orEmpty()
        val recent = rows.filter {
          it.id != personal?.conversationId && it.id != connection.pendingDeleteId && it.status != "archived" && !it.isLocalDraft
        }.take(6)
        recent.forEach { item ->
          Text(item.title, Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small)
            .background(if (item.id == connection.selectedConversationId) scheme.surfaceContainerHigh else Color.Transparent)
            .clickable(role = Role.Button) { onConversation(item.id) }.heightIn(min = 46.dp)
            .padding(horizontal = 10.dp, vertical = 12.dp).testTag("chat-sidebar-session-${item.id}"),
            maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge, color = scheme.onSurface)
        }
        if (connection.conversationsLoading && connection.recentConversations == null && rows.isEmpty())
          BrandLoadingIndicator(Modifier.padding(10.dp), extent = 24.dp)
        else if (connection.conversationsError && rows.isEmpty()) Row(Modifier.fillMaxWidth().padding(start = 10.dp),
          verticalAlignment = Alignment.CenterVertically) {
          Text(stringResource(R.string.chat_load_error), Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
          TextButton(onClick = onRetry, modifier = Modifier.testTag("chat-sidebar-retry")) {
            Text(stringResource(R.string.progress_refresh))
          }
        }
        SidebarRow(R.string.assistant_view_more, R.drawable.tab_conversations, "chat-sidebar-history") {
          onDestination(HomeTab.Conversations)
        }
      }
      Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Button(onClick = onNew, enabled = !connection.creatingConversation,
          colors = ButtonDefaults.buttonColors(containerColor = LocalChatColors.current.action,
            contentColor = LocalChatColors.current.onAction),
          modifier = Modifier.heightIn(min = 46.dp).testTag("chat-sidebar-new")) {
          Icon(painterResource(R.drawable.action_new_chat), null, Modifier.size(20.dp))
          Spacer(Modifier.width(8.dp))
          Text(stringResource(R.string.assistant_action_new_chat))
        }
        Spacer(Modifier.weight(1f))
        IconButton(onClick = { onDestination(HomeTab.Me) }, modifier = Modifier
          .background(scheme.surfaceContainer, CircleShape).testTag("chat-sidebar-profile")) {
          Icon(painterResource(R.drawable.settings_gear), stringResource(R.string.settings_title), Modifier.size(22.dp),
            tint = scheme.onSurface)
        }
      }
    }
  }
}

@Composable
private fun SidebarRow(@StringRes label: Int, @DrawableRes icon: Int, tag: String,
  modifier: Modifier = Modifier, badge: Int = 0, onClick: () -> Unit) {
  SidebarRow(stringResource(label), tag, modifier, badge, onClick = onClick) {
    Icon(painterResource(icon), null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun SidebarRow(label: String, tag: String, modifier: Modifier = Modifier, badge: Int = 0,
  enabled: Boolean = true, onClick: () -> Unit, icon: @Composable () -> Unit) {
  Row(modifier.fillMaxWidth().heightIn(min = 46.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
    .padding(horizontal = 10.dp).testTag(tag), verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    icon()
    Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge,
      maxLines = 1, overflow = TextOverflow.Ellipsis,
      color = MaterialTheme.colorScheme.onSurface)
    if (badge > 0) Text(if (badge > 99) "99+" else badge.toString(),
      Modifier.background(LocalAttentionColors.current.fill, CircleShape)
        .padding(horizontal = 8.dp, vertical = 4.dp).testTag("progress-attention-badge"),
      color = LocalAttentionColors.current.foreground,
      style = MaterialTheme.typography.labelMedium)
  }
}
