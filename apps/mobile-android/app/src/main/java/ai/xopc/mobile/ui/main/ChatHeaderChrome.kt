package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ContextDelegatedTask
import ai.xopc.mobile.gateway.ConversationContext
import ai.xopc.mobile.theme.LocalAttentionColors
import ai.xopc.mobile.theme.LocalChatColors
import ai.xopc.mobile.theme.themedCorners
import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal data class ChatHeaderModelParts(
  val name: String,
  val suffix: String?,
) {
  val fullText: String
    get() = if (suffix.isNullOrBlank()) name else "$name $suffix"
}

internal data class ChatHeaderIdentityModel(
  val hasConversationTitle: Boolean,
  val primaryText: String,
  val primaryRuntimeBadge: String?,
  val secondaryAgentName: String?,
  val secondaryRuntimeBadge: String?,
  val modelName: String?,
  val modelSuffix: String?,
) {
  val showsAvatarInPrimary: Boolean get() = !hasConversationTitle
  val showsAgentInSecondary: Boolean get() = secondaryAgentName != null
  val hasSecondaryRow: Boolean get() = secondaryAgentName != null || modelName != null
  val accessibilitySummary: String
    get() {
      val modelText = modelName?.let { ChatHeaderModelParts(it, modelSuffix).fullText }
      return listOfNotNull(primaryText, secondaryAgentName, modelText)
        .filter { it.isNotBlank() }
        .joinToString("，")
    }
}

internal data class ChatContextStripModel(
  val hasProject: Boolean,
  val projectTitle: String?,
  val taskText: String?,
  val environmentTag: String?,
  val needsAttention: Boolean,
  val isTaskActive: Boolean,
) {
  val summaryText: String
    get() = listOfNotNull(projectTitle, taskText, environmentTag)
      .filter { it.isNotBlank() }
      .joinToString(" · ")
}

private val attentionStates = setOf("review", "failed", "blocked", "needsuser", "needs_user", "waiting_for_user")
private val activeStates = setOf("running", "active", "in_progress", "verifying", "queued", "allocating")

internal fun shortThinkingLabel(level: String, isZh: Boolean): String? {
  return when (level.trim().lowercase()) {
    "", "off", "none" -> null
    "minimal" -> if (isZh) "极低" else "Min"
    "low" -> if (isZh) "低" else "Low"
    "medium" -> if (isZh) "中" else "Med"
    "high" -> if (isZh) "高" else "High"
    "xhigh" -> if (isZh) "极高" else "XHigh"
    "max" -> if (isZh) "最高" else "Max"
    else -> level.trim()
  }
}

internal fun chatModelSubtitleParts(
  modelName: String?,
  thinkingMode: String?,
  thinkingLevel: String,
  isFastEnabled: Boolean,
  isZh: Boolean,
): ChatHeaderModelParts? {
  val trimmed = modelName?.trim().orEmpty()
  if (trimmed.isEmpty()) return null
  val effort = if (thinkingMode == "levels" || thinkingMode == "toggle") {
    shortThinkingLabel(thinkingLevel, isZh)
  } else {
    null
  }
  val suffix = when {
    effort != null && isFastEnabled -> "· $effort ⚡"
    effort != null -> "· $effort"
    isFastEnabled -> "⚡"
    else -> null
  }
  return ChatHeaderModelParts(trimmed, suffix)
}

internal fun chatModelSubtitle(
  modelName: String?,
  thinkingMode: String?,
  thinkingLevel: String,
  isFastEnabled: Boolean,
  isZh: Boolean,
): String? = chatModelSubtitleParts(modelName, thinkingMode, thinkingLevel, isFastEnabled, isZh)?.fullText

internal fun chatHeaderIdentity(
  conversationTitle: String?,
  isDraft: Boolean,
  agentId: String?,
  defaultAgentId: String?,
  agentName: String,
  runtimeBadge: String?,
  modelParts: ChatHeaderModelParts?,
): ChatHeaderIdentityModel {
  val trimmedTitle = conversationTitle?.trim().orEmpty()
  val hasConversationTitle = !isDraft && trimmedTitle.isNotEmpty()
  val trimmedAgent = agentName.trim()
  val shownBadge = runtimeBadge?.takeIf { shouldShowRuntimeBadge(trimmedAgent, it) }
  val normalizedAgent = agentId?.trim()?.lowercase().orEmpty()
  val normalizedDefault = defaultAgentId?.trim()?.lowercase().orEmpty().ifEmpty { "main" }
  val isDefaultAgent = normalizedAgent.isEmpty() || normalizedAgent == normalizedDefault
  val showSecondaryAgent = hasConversationTitle && !isDefaultAgent && trimmedAgent.isNotEmpty()
  return ChatHeaderIdentityModel(
    hasConversationTitle = hasConversationTitle,
    primaryText = if (hasConversationTitle) trimmedTitle else trimmedAgent,
    primaryRuntimeBadge = if (hasConversationTitle) null else shownBadge,
    secondaryAgentName = if (showSecondaryAgent) trimmedAgent else null,
    secondaryRuntimeBadge = if (showSecondaryAgent) shownBadge else null,
    modelName = modelParts?.name,
    modelSuffix = modelParts?.suffix,
  )
}

internal fun localizedTaskPhase(phase: String?, isZh: Boolean): String? {
  return when (phase?.trim()?.lowercase().orEmpty()) {
    "review" -> if (isZh) "待验收" else "Review"
    "failed" -> if (isZh) "失败" else "Failed"
    "blocked" -> if (isZh) "受阻" else "Blocked"
    "needsuser", "needs_user", "waiting_for_user" -> if (isZh) "待处理" else "Needs you"
    "running", "active", "in_progress" -> if (isZh) "进行中" else "Active"
    "verifying" -> if (isZh) "验证中" else "Verifying"
    "queued" -> if (isZh) "排队中" else "Queued"
    "ready" -> if (isZh) "待开始" else "Ready"
    "backlog", "captured" -> if (isZh) "待规划" else "Backlog"
    "waiting" -> if (isZh) "等待中" else "Waiting"
    "paused" -> if (isZh) "已暂停" else "Paused"
    "completed", "done" -> if (isZh) "已完成" else "Done"
    "closed", "ended" -> if (isZh) "已结束" else "Closed"
    "cancelled" -> if (isZh) "已取消" else "Cancelled"
    else -> null
  }
}

internal fun chatContextStrip(
  context: ConversationContext?,
  fallbackProjectName: String?,
  isZh: Boolean,
): ChatContextStripModel? {
  val projectTitle = (context?.project?.title?.takeIf(String::isNotBlank)
    ?: fallbackProjectName?.takeIf(String::isNotBlank))?.trim()
  val taskTitle = context?.task?.title?.trim()?.takeIf(String::isNotEmpty)
  val taskPhase = context?.task?.phase?.trim()
  val delegatedTasks: List<ContextDelegatedTask> = context?.delegatedTasks.orEmpty()
  val delegatedCount = maxOf(context?.delegatedTaskCount ?: 0, delegatedTasks.size)

  if (projectTitle == null && taskTitle == null && delegatedCount <= 0) {
    return null
  }

  var taskText: String? = null
  var needsAttention = false
  var isTaskActive = false

  if (taskTitle != null) {
    val phaseLabel = localizedTaskPhase(taskPhase, isZh)
    taskText = if (phaseLabel != null) "$taskTitle · $phaseLabel" else taskTitle
    val lower = taskPhase?.lowercase().orEmpty()
    needsAttention = lower in attentionStates
    isTaskActive = lower in activeStates
  } else if (delegatedCount > 0) {
    val attentionCount = delegatedTasks.count { item ->
      item.phase.lowercase() in attentionStates || (item.runStatus?.lowercase() in attentionStates)
    }
    val activeCount = delegatedTasks.count { item ->
      item.phase.lowercase() in activeStates || (item.runStatus?.lowercase() in activeStates)
    }
    needsAttention = attentionCount > 0
    isTaskActive = activeCount > 0
    taskText = if (attentionCount > 0) {
      if (isZh) "$delegatedCount 项任务 · $attentionCount 待处理"
      else "$delegatedCount tasks · $attentionCount needs you"
    } else {
      if (isZh) "$delegatedCount 项派出任务"
      else "$delegatedCount ${if (delegatedCount == 1) "task" else "tasks"}"
    }
  }

  var environmentTag: String? = null
  if (taskText == null && projectTitle != null) {
    val branch = context?.environment?.branch?.trim()?.takeIf(String::isNotEmpty)
    if (context?.environment?.kind == "managed_worktree") {
      environmentTag = if (branch != null) "Worktree · $branch" else "Worktree"
    } else if (branch != null) {
      environmentTag = branch
    }
  }

  return ChatContextStripModel(
    hasProject = projectTitle != null,
    projectTitle = projectTitle,
    taskText = taskText,
    environmentTag = environmentTag,
    needsAttention = needsAttention,
    isTaskActive = isTaskActive,
  )
}

internal fun shouldShowRuntimeBadge(agentName: String, badge: String?): Boolean {
  val trimmed = badge?.trim().orEmpty()
  if (trimmed.isEmpty()) return false
  return !agentName.contains(trimmed, ignoreCase = true)
}

@Composable
internal fun ChatHeaderIdentityPill(
  agentAvatar: Bitmap?,
  agentAvatarRef: String,
  agentId: String,
  identity: ChatHeaderIdentityModel,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    onClick = onClick,
    shape = themedCorners(18),
    color = LocalChatColors.current.card,
    modifier = modifier
      .fillMaxWidth()
      .defaultMinSize(minHeight = 44.dp)
      .semantics { contentDescription = identity.accessibilitySummary }
      .testTag("chat-header-identity"),
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 12.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      if (identity.showsAvatarInPrimary) {
        AgentAvatar(
          avatar = agentAvatar,
          reference = agentAvatarRef,
          agentId = agentId,
          extent = 24.dp,
          active = false,
          fallbackName = identity.primaryText,
        )
      }
      Column(
        modifier = Modifier.weight(1f),
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(1.dp),
      ) {
        Row(
          modifier = Modifier.fillMaxWidth(),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
          Text(
            text = identity.primaryText,
            style = MaterialTheme.typography.titleSmall.copy(fontSize = 15.sp),
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
          )
          if (identity.primaryRuntimeBadge != null) {
            Surface(shape = themedCorners(999), color = MaterialTheme.colorScheme.surfaceVariant) {
              Text(
                text = identity.primaryRuntimeBadge,
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
              )
            }
          }
        }
        if (identity.hasSecondaryRow) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
          ) {
            if (identity.secondaryAgentName != null) {
              AgentAvatar(
                avatar = agentAvatar,
                reference = agentAvatarRef,
                agentId = agentId,
                extent = 14.dp,
                active = false,
                fallbackName = identity.secondaryAgentName,
              )
              Text(
                text = identity.secondaryAgentName,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 120.dp),
              )
              if (identity.secondaryRuntimeBadge != null) {
                Surface(shape = themedCorners(999), color = MaterialTheme.colorScheme.surfaceVariant) {
                  Text(
                    text = identity.secondaryRuntimeBadge,
                    fontSize = 9.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
                  )
                }
              }
              if (!identity.modelName.isNullOrBlank()) {
                Text(
                  text = "·",
                  style = MaterialTheme.typography.labelSmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                  maxLines = 1,
                )
              }
            }
            if (!identity.modelName.isNullOrBlank()) {
              Text(
                text = identity.modelName,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
              )
            }
            if (!identity.modelSuffix.isNullOrBlank()) {
              Text(
                text = identity.modelSuffix,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                softWrap = false,
              )
            }
          }
        }
      }
      Icon(
        painter = painterResource(R.drawable.action_chevron_down),
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
        modifier = Modifier.size(12.dp),
      )
    }
  }
}

@Composable
internal fun ChatContextStripBar(
  model: ChatContextStripModel,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val attentionColors = LocalAttentionColors.current
  Surface(
    onClick = onClick,
    shape = themedCorners(12),
    color = if (model.needsAttention) attentionColors.fill else LocalChatColors.current.card,
    modifier = modifier
      .heightIn(min = 32.dp)
      .semantics { contentDescription = model.summaryText }
      .testTag("chat-context-bar"),
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Icon(
        painter = painterResource(if (model.hasProject) R.drawable.action_folder else R.drawable.action_check_circle),
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(13.dp),
      )
      if (!model.projectTitle.isNullOrBlank()) {
        Text(
          text = model.projectTitle,
          style = MaterialTheme.typography.labelMedium,
          fontWeight = FontWeight.Medium,
          color = MaterialTheme.colorScheme.onSurface,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.widthIn(max = if (model.taskText != null) 120.dp else 220.dp),
        )
      }
      if (!model.taskText.isNullOrBlank()) {
        if (!model.projectTitle.isNullOrBlank()) {
          Text(
            text = "·",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        if (model.needsAttention || model.isTaskActive) {
          Box(
            modifier = Modifier
              .size(6.dp)
              .background(
                if (model.needsAttention) attentionColors.foreground else MaterialTheme.colorScheme.primary,
                CircleShape,
              ),
          )
        }
        Text(
          text = model.taskText,
          style = MaterialTheme.typography.labelMedium,
          fontWeight = if (model.needsAttention) FontWeight.Medium else FontWeight.Normal,
          color = if (model.needsAttention) attentionColors.foreground else MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.widthIn(max = 180.dp),
        )
      } else if (!model.environmentTag.isNullOrBlank()) {
        Text(
          text = "·",
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
          text = model.environmentTag,
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.widthIn(max = 140.dp),
        )
      }
      Icon(
        painter = painterResource(R.drawable.action_chevron_right),
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(12.dp),
      )
    }
  }
}

@Composable
internal fun DraftQuickSetupChips(
  agentAvatar: Bitmap?,
  agentAvatarRef: String,
  agentId: String,
  agentName: String,
  modelLabel: String?,
  projectTitle: String?,
  isZh: Boolean,
  onSelectAgent: () -> Unit,
  onSelectModel: () -> Unit,
  onSelectProject: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Row(
    modifier = modifier
      .horizontalScroll(rememberScrollState())
      .padding(horizontal = 4.dp)
      .testTag("chat-draft-quick-actions"),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Surface(
      onClick = onSelectAgent,
      shape = themedCorners(16),
      color = LocalChatColors.current.card,
      modifier = Modifier.heightIn(min = 36.dp).testTag("chat-welcome-agent"),
    ) {
      Row(
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        AgentAvatar(agentAvatar, agentAvatarRef, agentId, 16.dp, false, fallbackName = agentName)
        Text(
          text = agentName,
          style = MaterialTheme.typography.labelMedium,
          fontWeight = FontWeight.Medium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    Surface(
      onClick = onSelectModel,
      shape = themedCorners(16),
      color = LocalChatColors.current.card,
      modifier = Modifier.heightIn(min = 36.dp).testTag("chat-welcome-model"),
    ) {
      Row(
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(
          painter = painterResource(R.drawable.action_waveform),
          contentDescription = null,
          tint = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.size(13.dp),
        )
        Text(
          text = modelLabel ?: if (isZh) "默认模型" else "Default model",
          style = MaterialTheme.typography.labelMedium,
          fontWeight = FontWeight.Medium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    Surface(
      onClick = onSelectProject,
      shape = themedCorners(16),
      color = LocalChatColors.current.card,
      modifier = Modifier.heightIn(min = 36.dp).testTag("chat-welcome-project"),
    ) {
      Row(
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(
          painter = painterResource(R.drawable.action_folder),
          contentDescription = null,
          tint = if (projectTitle != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.size(13.dp),
        )
        Text(
          text = projectTitle ?: if (isZh) "关联项目" else "Project",
          style = MaterialTheme.typography.labelMedium,
          fontWeight = FontWeight.Medium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}
