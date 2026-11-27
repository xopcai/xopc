package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAbsoluteAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
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

/**
 * Flattened left navigation drawer with zero duplication against the 5 core bottom tabs.
 * Surfaces previously nested capability categories, work tools, and personal entries in 1 tap.
 */
@Composable
internal fun ChatSidebar(
  state: ChatSidebarState,
  width: Dp,
  creatingConversation: Boolean,
  onClose: () -> Unit,
  onSearch: () -> Unit,
  onCapability: (String) -> Unit,
  onAutomations: () -> Unit,
  onShareCenter: () -> Unit,
  onAboutYou: () -> Unit,
  onGoals: () -> Unit,
  onNew: () -> Unit,
  onSettings: () -> Unit,
) {
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

  Box(
    Modifier
      .fillMaxSize()
      .horizontalSwipe(
        enabled = state.open && widthPx > 0f,
        allowRight = false,
        onDrag = { state.dragFraction = (1f + it / widthPx).coerceIn(0f, 1f) },
        onRelease = { distance, speed ->
          settleDrag(
            -distance >= minOf(widthPx * 0.32f, closeDistance) ||
              -distance >= flickDistance && -speed >= flickVelocity,
          )
        },
        onCancel = { settleDrag(false) },
      ),
  ) {
    Box(
      Modifier
        .matchParentSize()
        .graphicsLayer { alpha = state.progress }
        .background(Color.Black.copy(alpha = 0.40f))
        .then(
          if (state.open) {
            Modifier
              .clickable(role = Role.Button, onClick = onClose)
              .semantics { contentDescription = dismissLabel }
              .testTag("chat-sidebar-scrim")
          } else {
            Modifier
          },
        ),
    )
    Column(
      Modifier
        .align(BiasAbsoluteAlignment(-1f, 0f))
        .width(width)
        .fillMaxHeight()
        .graphicsLayer { translationX = (state.progress - 1f) * size.width }
        .background(scheme.surface)
        .then(
          if (state.open) {
            Modifier.pointerInput(Unit) {
              awaitPointerEventScope { while (true) awaitPointerEvent() }
            }
          } else {
            Modifier.semantics { hideFromAccessibility() }
          },
        )
        .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical))
        .padding(horizontal = 14.dp)
        .testTag("chat-sidebar"),
    ) {
      Row(
        Modifier
          .fillMaxWidth()
          .padding(start = 12.dp, top = 6.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
      ) {
        val mark = if (scheme.surface.luminance() < 0.2f) {
          R.drawable.sidebar_brand_dark
        } else {
          R.drawable.sidebar_brand_light
        }
        Icon(painterResource(mark), null, Modifier.size(27.dp), tint = Color.Unspecified)
        Text(
          "xopc",
          Modifier.weight(1f),
          style = MaterialTheme.typography.titleLarge,
          fontWeight = FontWeight.Bold,
          color = scheme.onSurface,
        )
        IconButton(
          onClick = onClose,
          modifier = Modifier
            .testTag("chat-sidebar-close")
            .background(scheme.surfaceContainer, CircleShape),
        ) {
          Icon(
            painterResource(R.drawable.action_close),
            dismissLabel,
            Modifier.size(22.dp),
            tint = scheme.onSurface,
          )
        }
      }

      LazyColumn(
        Modifier
          .weight(1f)
          .fillMaxWidth()
          .testTag("chat-sidebar-list"),
        verticalArrangement = Arrangement.spacedBy(2.dp),
        contentPadding = PaddingValues(bottom = 12.dp),
      ) {
        item("search") {
          SidebarRow(
            label = R.string.conversations_search,
            icon = R.drawable.action_search,
            tag = "chat-sidebar-search",
            modifier = Modifier
              .padding(bottom = 8.dp)
              .clip(MaterialTheme.shapes.large)
              .background(scheme.surfaceContainer),
            onClick = onSearch,
          )
        }

        // Section 1: Capabilities (6 direct 1-tap rows flattened out of CapabilitiesScreen)
        item("section-capabilities") {
          SidebarSectionHeader(R.string.capability_title)
        }
        item("capability-plugins") {
          SidebarRow(
            label = R.string.capability_plugins,
            icon = R.drawable.action_capabilities,
            tag = "chat-sidebar-capability-plugins",
            onClick = { onCapability("plugins") },
          )
        }
        item("capability-skills") {
          SidebarRow(
            label = R.string.capability_skills,
            icon = R.drawable.action_task_list,
            tag = "chat-sidebar-capability-skills",
            onClick = { onCapability("skills") },
          )
        }
        item("capability-connections") {
          SidebarRow(
            label = R.string.capability_connections,
            icon = R.drawable.action_link,
            tag = "chat-sidebar-capability-connections",
            onClick = { onCapability("connections") },
          )
        }
        item("capability-devices") {
          SidebarRow(
            label = R.string.capability_devices,
            icon = R.drawable.action_phone,
            tag = "chat-sidebar-capability-devices",
            onClick = { onCapability("devices") },
          )
        }
        item("capability-agents") {
          SidebarRow(
            label = R.string.capability_agents,
            icon = R.drawable.tab_assistant,
            tag = "chat-sidebar-capability-agents",
            onClick = { onCapability("agents") },
          )
        }
        item("capability-channels") {
          SidebarRow(
            label = R.string.capability_channels,
            icon = R.drawable.tab_conversations,
            tag = "chat-sidebar-capability-channels",
            onClick = { onCapability("channels") },
          )
        }

        // Section 2: Work & tools
        item("divider-work-tools") {
          SidebarSectionDivider()
        }
        item("section-work-tools") {
          SidebarSectionHeader(R.string.sidebar_section_work_tools)
        }
        item("automations") {
          SidebarRow(
            label = R.string.progress_automations,
            icon = R.drawable.action_clock,
            tag = "chat-sidebar-automations",
            onClick = onAutomations,
          )
        }
        item("share-center") {
          SidebarRow(
            label = R.string.sidebar_share_center,
            icon = R.drawable.message_share,
            tag = "chat-sidebar-share-center",
            onClick = onShareCenter,
          )
        }

        // Section 3: Me
        item("divider-me") {
          SidebarSectionDivider()
        }
        item("section-me") {
          SidebarSectionHeader(R.string.tab_me)
        }
        item("about") {
          SidebarRow(
            label = R.string.about_you_title,
            icon = R.drawable.tab_me,
            tag = "chat-sidebar-about",
            onClick = onAboutYou,
          )
        }
        item("goals") {
          SidebarRow(
            label = R.string.personal_goals,
            icon = R.drawable.action_check_circle,
            tag = "chat-sidebar-goals",
            onClick = onGoals,
          )
        }
      }

      Row(
        Modifier
          .fillMaxWidth()
          .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Button(
          onClick = onNew,
          enabled = !creatingConversation,
          colors = ButtonDefaults.buttonColors(
            containerColor = LocalChatColors.current.action,
            contentColor = LocalChatColors.current.onAction,
          ),
          modifier = Modifier
            .heightIn(min = 46.dp)
            .testTag("chat-sidebar-new"),
        ) {
          Icon(painterResource(R.drawable.action_new_chat), null, Modifier.size(20.dp))
          Spacer(Modifier.width(8.dp))
          Text(stringResource(R.string.assistant_action_new_chat))
        }
        Spacer(Modifier.weight(1f))
        IconButton(
          onClick = onSettings,
          modifier = Modifier
            .background(scheme.surfaceContainer, CircleShape)
            .testTag("chat-sidebar-profile"),
        ) {
          Icon(
            painterResource(R.drawable.action_settings),
            stringResource(R.string.settings_title),
            Modifier.size(22.dp),
            tint = scheme.onSurface,
          )
        }
      }
    }
  }
}

@Composable
private fun SidebarSectionHeader(@StringRes title: Int) {
  Text(
    text = stringResource(title),
    style = MaterialTheme.typography.labelMedium,
    fontWeight = FontWeight.SemiBold,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = Modifier.padding(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 4.dp),
  )
}

@Composable
private fun SidebarSectionDivider() {
  HorizontalDivider(
    modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
  )
}

@Composable
private fun SidebarRow(
  @StringRes label: Int,
  @DrawableRes icon: Int,
  tag: String,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = 46.dp)
      .clip(MaterialTheme.shapes.small)
      .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
      .padding(horizontal = 10.dp)
      .testTag(tag),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
      Icon(
        painterResource(icon),
        null,
        Modifier.size(21.dp),
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    Text(
      stringResource(label),
      Modifier.weight(1f),
      style = MaterialTheme.typography.bodyLarge,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      color = MaterialTheme.colorScheme.onSurface,
    )
  }
}
