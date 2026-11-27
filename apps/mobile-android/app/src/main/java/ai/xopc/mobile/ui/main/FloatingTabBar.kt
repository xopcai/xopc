package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.theme.LocalAttentionColors
import ai.xopc.mobile.theme.LocalChatColors
import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal val FLOATING_TAB_BAR_HEIGHT: Dp = 60.dp
internal val FLOATING_TAB_BAR_COMPOSER_GAP: Dp = 10.dp
internal val FLOATING_TAB_BAR_BOTTOM_MARGIN: Dp = 8.dp
internal val FLOATING_TAB_BAR_TOTAL_INSET: Dp = FLOATING_TAB_BAR_HEIGHT + FLOATING_TAB_BAR_BOTTOM_MARGIN + FLOATING_TAB_BAR_COMPOSER_GAP

/**
 * Floating pill bottom navigation bar with 5 core slots (Ada, Conversations, Workbench, Notes, Library).
 * Designed with >=48dp touch targets, translucent/elevated pill surface, and active capsule highlight.
 */
@Composable
internal fun FloatingTabBar(
  selectedTab: MobileTab,
  onSelectTab: (MobileTab) -> Unit,
  personalName: String?,
  personalAvatar: Bitmap?,
  personalAppearance: String,
  personalUnread: Int,
  personalActive: Boolean,
  workbenchAttention: Int,
  notesPendingRecording: Boolean,
  modifier: Modifier = Modifier,
) {
  val scheme = MaterialTheme.colorScheme
  val chatColors = LocalChatColors.current
  val attentionColors = LocalAttentionColors.current
  val haptics = LocalHapticFeedback.current
  val isDark = scheme.background.luminance() < 0.2f
  val barLabel = stringResource(R.string.tab_bar_description)
  val adaLabel = personalName?.trim()?.takeIf { it.isNotEmpty() } ?: stringResource(R.string.tab_ada_fallback)
  val conversationsLabel = stringResource(R.string.tab_conversations)
  val workbenchLabel = stringResource(R.string.tab_workbench)
  val notesLabel = stringResource(R.string.tab_notes)
  val libraryLabel = stringResource(R.string.library_title)
  val pendingRecordingDescription = stringResource(R.string.notes_pending_recording_indicator)

  // Translucent elevated pill surface; falls back cleanly to solid border-framed contrast in dark/light modes.
  val pillColor = if (isDark) {
    scheme.surfaceContainer.copy(alpha = 0.94f)
  } else {
    scheme.surface.copy(alpha = 0.95f)
  }
  val borderColor = scheme.outlineVariant.copy(alpha = if (isDark) 0.55f else 0.45f)

  Box(
    modifier = modifier
      .fillMaxWidth()
      .navigationBarsPadding()
      .padding(horizontal = 12.dp)
      .padding(bottom = FLOATING_TAB_BAR_BOTTOM_MARGIN),
    contentAlignment = Alignment.Center,
  ) {
    Surface(
      shape = CircleShape,
      color = pillColor,
      border = BorderStroke(1.dp, borderColor),
      shadowElevation = if (isDark) 2.dp else 6.dp,
      tonalElevation = if (isDark) 2.dp else 0.dp,
      modifier = Modifier
        .fillMaxWidth()
        .widthIn(max = 440.dp)
        .height(FLOATING_TAB_BAR_HEIGHT)
        .semantics { contentDescription = barLabel }
        .testTag("floating-tab-bar"),
    ) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = 4.dp, vertical = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        val adaUnreadDesc = if (personalUnread > 0) {
          pluralStringResource(R.plurals.personal_unread_messages, personalUnread, personalUnread)
        } else null
        FloatingTabSlot(
          label = adaLabel,
          isSelected = selectedTab == MobileTab.Ada,
          tag = "floating-tab-ada",
          badgeCount = personalUnread,
          badgeFill = scheme.primary,
          badgeTextColor = scheme.onPrimary,
          badgeTag = "floating-tab-ada-badge",
          badgeContentDescription = adaUnreadDesc,
          showDot = personalActive && personalUnread == 0,
          dotColor = chatColors.action,
          dotTag = "floating-tab-ada-active-dot",
          dotDescription = null,
          onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onSelectTab(MobileTab.Ada)
          },
          modifier = Modifier.weight(1f),
        ) { selected ->
          PersonalAgentAvatar(
            avatar = personalAvatar,
            appearance = personalAppearance,
            extent = 21.dp,
            active = selected || personalActive,
          )
        }

        FloatingTabSlot(
          label = conversationsLabel,
          isSelected = selectedTab == MobileTab.Conversations,
          tag = "floating-tab-conversations",
          badgeCount = 0,
          badgeFill = scheme.primary,
          badgeTextColor = scheme.onPrimary,
          badgeTag = null,
          badgeContentDescription = null,
          showDot = false,
          dotColor = scheme.primary,
          dotTag = null,
          dotDescription = null,
          onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onSelectTab(MobileTab.Conversations)
          },
          modifier = Modifier.weight(1f),
        ) { selected ->
          Icon(
            painter = painterResource(R.drawable.tab_conversations),
            contentDescription = null,
            tint = if (selected) scheme.primary else scheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
          )
        }

        FloatingTabSlot(
          label = workbenchLabel,
          isSelected = selectedTab == MobileTab.Workbench,
          tag = "floating-tab-workbench",
          badgeCount = workbenchAttention,
          badgeFill = attentionColors.fill,
          badgeTextColor = attentionColors.foreground,
          badgeTag = "floating-tab-workbench-badge",
          badgeContentDescription = null,
          showDot = false,
          dotColor = attentionColors.foreground,
          dotTag = null,
          dotDescription = null,
          onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onSelectTab(MobileTab.Workbench)
          },
          modifier = Modifier.weight(1f),
        ) { selected ->
          Icon(
            painter = painterResource(R.drawable.tab_progress),
            contentDescription = null,
            tint = if (selected) scheme.primary else scheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
          )
        }

        FloatingTabSlot(
          label = notesLabel,
          isSelected = selectedTab == MobileTab.Notes,
          tag = "floating-tab-notes",
          badgeCount = 0,
          badgeFill = scheme.primary,
          badgeTextColor = scheme.onPrimary,
          badgeTag = null,
          badgeContentDescription = null,
          showDot = notesPendingRecording,
          dotColor = scheme.error,
          dotTag = "floating-tab-notes-dot",
          dotDescription = pendingRecordingDescription,
          onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onSelectTab(MobileTab.Notes)
          },
          modifier = Modifier.weight(1f),
        ) { selected ->
          Icon(
            painter = painterResource(R.drawable.tab_notes),
            contentDescription = null,
            tint = if (selected) scheme.primary else scheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
          )
        }

        FloatingTabSlot(
          label = libraryLabel,
          isSelected = selectedTab == MobileTab.Library,
          tag = "floating-tab-library",
          badgeCount = 0,
          badgeFill = scheme.primary,
          badgeTextColor = scheme.onPrimary,
          badgeTag = null,
          badgeContentDescription = null,
          showDot = false,
          dotColor = scheme.primary,
          dotTag = null,
          dotDescription = null,
          onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onSelectTab(MobileTab.Library)
          },
          modifier = Modifier.weight(1f),
        ) { selected ->
          Icon(
            painter = painterResource(R.drawable.action_folder),
            contentDescription = null,
            tint = if (selected) scheme.primary else scheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
          )
        }
      }
    }
  }
}

@Composable
private fun FloatingTabSlot(
  label: String,
  isSelected: Boolean,
  tag: String,
  badgeCount: Int,
  badgeFill: Color,
  badgeTextColor: Color,
  badgeTag: String?,
  badgeContentDescription: String?,
  showDot: Boolean,
  dotColor: Color,
  dotTag: String?,
  dotDescription: String?,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  icon: @Composable (selected: Boolean) -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  val capsuleColor = if (isSelected) scheme.primaryContainer else Color.Transparent
  val textColor = if (isSelected) scheme.primary else scheme.onSurfaceVariant
  val interaction = remember { MutableInteractionSource() }

  Box(
    modifier = modifier
      .heightIn(min = 48.dp)
      .clip(CircleShape)
      .background(capsuleColor)
      .clickable(
        interactionSource = interaction,
        indication = null,
        role = Role.Tab,
        onClick = onClick,
      )
      .semantics {
        selected = isSelected
        if (badgeContentDescription != null) {
          contentDescription = "$label, $badgeContentDescription"
        }
      }
      .testTag(tag),
    contentAlignment = Alignment.Center,
  ) {
    Column(
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(2.dp),
      modifier = Modifier.padding(horizontal = 2.dp, vertical = 4.dp),
    ) {
      Box(contentAlignment = Alignment.TopEnd) {
        Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
          icon(isSelected)
        }
        if (badgeCount > 0) {
          val badgeMod = Modifier
            .offset(x = 8.dp, y = (-4).dp)
            .background(badgeFill, CircleShape)
            .padding(horizontal = 4.dp, vertical = 1.dp)
            .let { m -> if (badgeTag != null) m.testTag(badgeTag) else m }
          Text(
            text = if (badgeCount > 99) "99+" else badgeCount.toString(),
            color = badgeTextColor,
            fontSize = 10.sp,
            lineHeight = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            modifier = badgeMod,
          )
        } else if (showDot) {
          val dotMod = Modifier
            .offset(x = 3.dp, y = (-1).dp)
            .size(7.dp)
            .clip(CircleShape)
            .background(dotColor)
            .let { m -> if (dotTag != null) m.testTag(dotTag) else m }
            .let { m ->
              if (dotDescription != null) m.semantics { contentDescription = dotDescription } else m
            }
          Box(dotMod)
        }
      }
      Text(
        text = label,
        color = textColor,
        fontSize = 10.sp,
        lineHeight = 12.sp,
        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
        maxLines = 1,
        softWrap = false,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}
