package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.theme.LocalAttentionColors
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ProgressHomeAction
import ai.xopc.mobile.gateway.ProgressItem
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProgressOverview(state: ProgressUiState, onRefresh: () -> Unit,
  onOpenChat: (String) -> Unit, onOpenAutomations: () -> Unit, onOpenAutomation: (String) -> Unit,
  onOpenTask: (String) -> Unit, onRequestAction: (ProgressHomeAction) -> Unit,
  onOpenRun: (String) -> Unit, onOpenLibrary: (() -> Unit)? = null) {
  val (scheduled, running) = remember(state.background) {
    state.background.partition { it.kind == "scheduled" }
  }
  val pendingCount = state.needsUser.size
  val deliveries = state.deliveries.take(5)
  val initialLoading = state.homeLoading && state.needsUser.isEmpty() && state.background.isEmpty() &&
    deliveries.isEmpty() && state.automationMetrics?.nextRun == null
  val listState = rememberLazyListState()
  fun open(item: ProgressItem) {
    item.openAction?.href?.let(::progressDestination)?.let { (page, id) ->
      when (page) {
        "chat" -> onOpenChat(id)
        "tasks" -> onOpenTask(id)
        "automations" -> onOpenAutomation(id)
      }
    }
  }
  XopcPullToRefreshBox(
    isRefreshing = state.homeLoading && (state.needsUser.isNotEmpty() || state.background.isNotEmpty()),
    onRefresh = onRefresh, modifier = Modifier.fillMaxSize().testTag("progress-refresh-gesture")) {
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize().testTag("progress-overview-list"),
      verticalArrangement = Arrangement.spacedBy(8.dp),
      contentPadding = PaddingValues(bottom = 20.dp)) {
      if (state.homeActionError) item(key = "action-error", contentType = "error") {
        XopcInlineBanner(
          message = stringResource(R.string.progress_home_action_error),
          tone = XopcBannerTone.Danger,
          modifier = Modifier.testTag("progress-home-action-error"),
        )
      }
      if (initialLoading) item(key = "loading", contentType = "loading") {
        XopcListSkeleton(modifier = Modifier.testTag("progress-loading"), rows = 3)
      } else {
        if (state.needsUser.isNotEmpty()) {
          item(key = "needs-heading", contentType = "heading") {
            ProgressOverviewSection(R.string.progress_action_required, count = pendingCount)
          }
          items(state.needsUser, key = { "needs-${it.id}" }, contentType = { "attention" }) { item ->
            ProgressAttentionRow(item, state.homeActionBusy, { open(item) }, onRequestAction)
          }
        }
        if (deliveries.isNotEmpty()) {
          item(key = "delivery-heading", contentType = "heading") {
            ProgressOverviewSection(R.string.progress_delivered, R.string.progress_view_library,
              "progress-open-library", onOpenLibrary)
          }
          items(deliveries, key = { "delivery-${it.id}" }, contentType = { "work" }) { item ->
            ProgressHubRow(item.title, item.summary, R.drawable.tab_progress, "progress-delivery-${item.id}") {
              if (item.kind == "task") onOpenTask(item.subjectId) else onOpenRun(item.subjectId)
            }
          }
        }
        if (running.isNotEmpty()) {
          item(key = "running-heading", contentType = "heading") { ProgressOverviewSection(R.string.progress_ongoing) }
          items(running.take(5), key = { "ongoing-${it.id}" }, contentType = { "work" }) { item ->
            ProgressHubRow(item.title, listOfNotNull(item.statusLabel, item.summary.takeIf(String::isNotBlank)).joinToString(" · "),
              R.drawable.action_clock, "progress-item-${item.id}",
              navigable = item.openAction?.href?.let(::progressDestination) != null) { open(item) }
          }
        }
        if (state.homeError) item(key = "home-error", contentType = "error") {
          XopcErrorState(
            message = stringResource(R.string.progress_load_failed),
            retryLabel = stringResource(R.string.progress_refresh),
            onRetry = onRefresh,
            retryTag = "progress-retry",
          )
        }
        if (scheduled.isNotEmpty()) {
          item(key = "upcoming-heading", contentType = "heading") {
            ProgressOverviewSection(R.string.progress_upcoming, R.string.progress_view_automations,
              "progress-automations", onOpenAutomations)
          }
          items(scheduled.take(5), key = { "scheduled-${it.id}" }, contentType = { "work" }) { item ->
            ProgressHubRow(item.title, listOfNotNull(item.statusLabel, item.summary.takeIf(String::isNotBlank)).joinToString(" · "),
              R.drawable.action_clock, "progress-item-${item.id}",
              navigable = item.openAction?.href?.let(::progressDestination) != null) { open(item) }
          }
        } else state.automationMetrics?.nextRun?.let { next ->
          item(key = "upcoming-heading", contentType = "heading") {
            ProgressOverviewSection(R.string.progress_upcoming, R.string.progress_view_automations,
              "progress-automations", onOpenAutomations)
          }
          item(key = "upcoming-${next.automationId}", contentType = "work") {
            ProgressHubRow(next.name, DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(next.runAtMs)),
              R.drawable.action_clock, "progress-upcoming-${next.automationId}") { onOpenAutomation(next.automationId) }
          }
        }
        if (!state.homeError && pendingCount == 0 && deliveries.isEmpty() && state.background.isEmpty() &&
          state.automationMetrics?.nextRun == null) item(key = "empty") {
          XopcEmptyState(message = stringResource(R.string.progress_overview_empty))
        }
      }
    }
  }
}

@Composable
private fun ProgressOverviewSection(label: Int, actionLabel: Int? = null, actionTag: String = "",
  onAction: (() -> Unit)? = null, count: Int? = null) {
  Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp),
    verticalAlignment = Alignment.CenterVertically) {
    Text(stringResource(label), style = MaterialTheme.typography.titleSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.weight(1f).semantics { heading() })
    count?.let { Text(it.toString(), style = MaterialTheme.typography.labelLarge,
      color = MaterialTheme.colorScheme.onSurfaceVariant) }
    if (actionLabel != null && onAction != null) TextButton(onClick = onAction, modifier = Modifier.testTag(actionTag)) {
      Text(stringResource(actionLabel))
    }
  }
}

@Composable
private fun ProgressChevron(color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant) {
  Icon(painterResource(R.drawable.action_chevron_right), contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
}

@Composable
private fun ProgressHubRow(title: String, summary: String, icon: Int, tag: String,
  navigable: Boolean = true, onOpen: () -> Unit) {
  Card(onClick = onOpen, enabled = navigable, modifier = Modifier.fillMaxWidth().testTag(tag),
    shape = MaterialTheme.shapes.medium, colors = CardDefaults.cardColors(
      containerColor = MaterialTheme.colorScheme.surfaceContainer,
      disabledContainerColor = MaterialTheme.colorScheme.surfaceContainer)) {
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp, vertical = 12.dp),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(23.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, fontSize = 16.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium,
          color = MaterialTheme.colorScheme.onSurface, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (summary.isNotBlank()) Text(summary, fontSize = 13.sp, lineHeight = 18.sp,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
      if (navigable) ProgressChevron()
    }
  }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun ProgressAttentionRow(item: ProgressItem, busy: Boolean, onOpen: () -> Unit,
  onRequestAction: (ProgressHomeAction) -> Unit) {
  var reviewExpanded by rememberSaveable(item.id) { mutableStateOf(false) }
  val openAction = item.openAction
  val canOpen = openAction?.href?.let(::progressDestination) != null
  val dedupedSecondary = remember(item.secondaryActions, openAction, canOpen) {
    if (openAction == null || !canOpen) item.secondaryActions else item.secondaryActions.filterNot { action ->
      action.label == openAction.label ||
        (action.reviewTaskId != null && openAction.href == "/tasks/${action.reviewTaskId}")
    }
  }
  val hasActions = item.primaryAction != null || dedupedSecondary.isNotEmpty()
  val localizedSummary = when {
    item.summary.contains("provider_setup_required", ignoreCase = true) ->
      stringResource(R.string.progress_attention_provider_setup)
    item.summary.contains("run was still active", ignoreCase = true) ->
      stringResource(R.string.progress_attention_interrupted_run)
    else -> item.summary
  }
  val attention = LocalAttentionColors.current
  Card(shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth(),
    colors = CardDefaults.cardColors(containerColor = attention.fill, contentColor = MaterialTheme.colorScheme.onSurface)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Column(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small).testTag("progress-item-${item.id}")
        .clickable(enabled = canOpen, onClick = onOpen),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item.statusLabel?.takeIf(String::isNotBlank)?.let { status ->
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(6.dp).background(attention.foreground, CircleShape))
            Text(status, fontSize = 12.sp, fontWeight = FontWeight.Medium,
              color = attention.foreground)
          }
        }
        Text(item.title, fontSize = 16.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium,
          maxLines = 3, overflow = TextOverflow.Ellipsis)
        if (localizedSummary.isNotBlank() && localizedSummary != item.title) Text(localizedSummary, fontSize = 13.sp, lineHeight = 19.sp,
          color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (canOpen) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(item.openAction.label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.primary)
          ProgressChevron(MaterialTheme.colorScheme.primary)
        }
      }
      if (!item.reviewDetail.isNullOrBlank() && item.reviewDetail != item.summary) {
        TextButton(onClick = { reviewExpanded = !reviewExpanded }, modifier = Modifier.testTag("progress-review-${item.id}")) {
          Text(stringResource(if (reviewExpanded) R.string.progress_hide_review else R.string.progress_show_review))
        }
        if (reviewExpanded) MarkdownContent(item.reviewDetail, modifier = Modifier.testTag("progress-review-detail-${item.id}"))
      }
      if (hasActions) {
        item.recommendation?.takeIf(String::isNotBlank)?.let {
          Text(it, fontSize = 12.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          item.primaryAction?.let { action ->
            FilledTonalButton(onClick = { onRequestAction(action) }, enabled = !busy,
              modifier = Modifier.heightIn(min = 44.dp).testTag("progress-home-primary-${item.id}")) { Text(action.label) }
          }
          dedupedSecondary.forEachIndexed { index, action ->
            TextButton(onClick = { onRequestAction(action) }, enabled = !busy,
              modifier = Modifier.heightIn(min = 44.dp).testTag("progress-home-secondary-${item.id}-$index")) { Text(action.label) }
          }
        }
      }
    }
  }
}
