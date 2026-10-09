package ai.xopc.mobile.ui.main

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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProgressOverview(state: ProgressUiState, onRefresh: () -> Unit,
  onOpenChat: (String) -> Unit, onOpenTaskList: () -> Unit, onOpenProjects: () -> Unit,
  onOpenAutomations: () -> Unit, onOpenAutomation: (String) -> Unit,
  onOpenTask: (String) -> Unit, onRequestAction: (ProgressHomeAction) -> Unit,
  bottomChromeHeight: Dp) {
  val running = state.background.filter { it.kind != "scheduled" }
  val scheduled = state.background.filter { it.kind == "scheduled" }
  val pendingCount = if (state.homeLoading || state.homeError) 0 else state.needsUser.size
  val runningCount = if (state.homeLoading || state.homeError) 0 else running.size
  val listState = rememberLazyListState()
  val scope = rememberCoroutineScope()
  fun open(item: ProgressItem) {
    item.openAction?.href?.let(::progressDestination)?.let { (page, id) ->
      when (page) {
        "chat" -> onOpenChat(id)
        "tasks" -> onOpenTask(id)
        "automations" -> onOpenAutomation(id)
      }
    }
  }
  androidx.compose.material3.pulltorefresh.PullToRefreshBox(
    isRefreshing = state.homeLoading && (state.needsUser.isNotEmpty() || state.background.isNotEmpty()),
    onRefresh = onRefresh, modifier = Modifier.fillMaxSize().testTag("progress-refresh-gesture")) {
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize().testTag("progress-overview-list"),
      verticalArrangement = Arrangement.spacedBy(8.dp),
      contentPadding = PaddingValues(bottom = bottomChromeHeight + 20.dp)) {
      item(key = "summary") {
        Card(shape = RoundedCornerShape(20.dp),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
          Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              ProgressCount(pendingCount, R.string.progress_action_required, "progress-pending-count", Modifier.weight(1f)) {
                scope.launch { listState.animateScrollToItem(1) }
              }
              VerticalDivider(Modifier.height(42.dp))
              ProgressCount(runningCount, R.string.progress_ongoing, "progress-running-count", Modifier.weight(1f)) {
                scope.launch { listState.animateScrollToItem(1 + if (pendingCount > 0) pendingCount + 1 else 0) }
              }
            }
            Text(stringResource(R.string.progress_hint), style = MaterialTheme.typography.bodySmall,
              lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
              modifier = Modifier.padding(horizontal = 10.dp))
          }
        }
      }
      if (state.homeLoading) item {
        Column(Modifier.fillMaxWidth().testTag("progress-loading").padding(vertical = 12.dp),
          verticalArrangement = Arrangement.spacedBy(18.dp)) {
          repeat(3) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              Box(Modifier.size(28.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(6.dp)))
              Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.fillMaxWidth(0.75f).height(16.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(4.dp)))
                Box(Modifier.fillMaxWidth(0.5f).height(12.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(4.dp)))
              }
            }
          }
        }
      } else {
        if (state.homeError) item {
          OutlinedButton(onClick = onRefresh, modifier = Modifier.testTag("progress-retry")) {
            Text(stringResource(R.string.progress_load_failed))
          }
        } else {
          if (state.needsUser.isNotEmpty()) {
            item(key = "needs-heading") { ProgressOverviewSection(R.string.progress_needs_you) }
            items(state.needsUser, key = { "needs-${it.id}" }) { item ->
              ProgressAttentionRow(item, state.homeActionBusy, { open(item) }, onRequestAction)
            }
          }
          if (running.isNotEmpty()) {
            item(key = "running-heading") { ProgressOverviewSection(R.string.progress_ongoing) }
            items(running.take(5), key = { "ongoing-${it.id}" }) { item ->
              ProgressHubRow(item.title, listOfNotNull(item.statusLabel, item.summary.takeIf(String::isNotBlank)).joinToString(" · "),
                R.drawable.action_clock, "progress-item-${item.id}",
                navigable = item.openAction?.href?.let(::progressDestination) != null) { open(item) }
            }
          }
        }
        if (scheduled.isNotEmpty()) {
          item { ProgressOverviewSection(R.string.progress_upcoming) }
          items(scheduled.take(5), key = { "scheduled-${it.id}" }) { item ->
            ProgressHubRow(item.title, listOfNotNull(item.statusLabel, item.summary.takeIf(String::isNotBlank)).joinToString(" · "),
              R.drawable.action_clock, "progress-item-${item.id}",
              navigable = item.openAction?.href?.let(::progressDestination) != null) { open(item) }
          }
        } else state.automationMetrics?.nextRun?.let { next ->
          item { ProgressOverviewSection(R.string.progress_upcoming) }
          item {
            ProgressHubRow(next.name, DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(next.runAtMs)),
              R.drawable.action_clock, "progress-upcoming-${next.automationId}") { onOpenAutomation(next.automationId) }
          }
        }
        if (state.tasksError) item {
          Text(stringResource(R.string.progress_tasks_error), color = MaterialTheme.colorScheme.error)
        } else if (state.recentClosedTasks.isNotEmpty()) {
          item { ProgressOverviewSection(R.string.progress_recent_closed) }
          items(state.recentClosedTasks.take(2), key = { "closed-${it.id}" }) { task ->
            ProgressHubRow(task.title, task.resolution?.let { taskResolutionLabel(it) }.orEmpty(),
              R.drawable.tab_progress, "progress-closed-${task.id}") { onOpenTask(task.id) }
          }
        }
      }
      if (state.homeActionError) item {
        Text(stringResource(R.string.progress_home_action_error), color = MaterialTheme.colorScheme.error,
          modifier = Modifier.testTag("progress-home-action-error"))
      }
      item(key = "tools-heading") { ProgressOverviewSection(R.string.progress_frequent_tools) }
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          ProgressShortcut(R.string.progress_tasks, R.drawable.tab_progress, onOpenTaskList,
            Modifier.weight(1f).testTag("progress-tasks"))
          ProgressShortcut(R.string.progress_projects, R.drawable.action_folder, onOpenProjects,
            Modifier.weight(1f).testTag("progress-projects"))
        }
      }
      item {
        ProgressShortcut(R.string.progress_automations, R.drawable.action_clock, onOpenAutomations,
          Modifier.fillMaxWidth().padding(top = 4.dp).testTag("progress-automations"))
      }
    }
  }
}

@Composable
private fun ProgressCount(count: Int, label: Int, tag: String, modifier: Modifier, onClick: () -> Unit) {
  Row(modifier.height(64.dp).testTag(tag).clickable(enabled = count > 0, onClick = onClick).padding(10.dp),
    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(count.toString(), fontSize = 24.sp, fontWeight = FontWeight.Bold,
        color = if (count > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
      Text(stringResource(label), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (count > 0) ProgressChevron(MaterialTheme.colorScheme.primary)
  }
}

@Composable
private fun ProgressOverviewSection(label: Int) {
  Text(stringResource(label), fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium,
    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 8.dp))
}

@Composable
private fun ProgressChevron(color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant) {
  Icon(painterResource(R.drawable.action_chevron_right), contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
}

@Composable
private fun ProgressShortcut(label: Int, icon: Int, onClick: () -> Unit, modifier: Modifier) {
  Card(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
    Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 12.dp),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      Box(Modifier.size(34.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
      }
      Text(stringResource(label), modifier = Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1)
      ProgressChevron()
    }
  }
}

@Composable
private fun ProgressHubRow(title: String, summary: String, icon: Int, tag: String,
  navigable: Boolean = true, onOpen: () -> Unit) {
  Card(onClick = onOpen, enabled = navigable, modifier = Modifier.fillMaxWidth().testTag(tag),
    shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(
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
private fun ProgressAttentionRow(item: ProgressItem, busy: Boolean, onOpen: () -> Unit,
  onRequestAction: (ProgressHomeAction) -> Unit) {
  var reviewExpanded by rememberSaveable(item.id) { mutableStateOf(false) }
  val canOpen = item.openAction?.href?.let(::progressDestination) != null
  val hasActions = item.primaryAction != null || item.secondaryActions.isNotEmpty()
  Card(shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Column(Modifier.fillMaxWidth().testTag("progress-item-${item.id}").clickable(enabled = canOpen, onClick = onOpen),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          Box(Modifier.size(7.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
          Text(stringResource(R.string.progress_action_required), fontSize = 12.sp, fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.primary)
        }
        Text(item.title, fontSize = 16.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium,
          maxLines = 3, overflow = TextOverflow.Ellipsis)
        if (item.summary.isNotBlank() && item.summary != item.title) Text(item.summary, fontSize = 13.sp, lineHeight = 19.sp,
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
          item.secondaryActions.forEachIndexed { index, action ->
            TextButton(onClick = { onRequestAction(action) }, enabled = !busy,
              modifier = Modifier.heightIn(min = 44.dp).testTag("progress-home-secondary-${item.id}-$index")) { Text(action.label) }
          }
        }
      }
    }
  }
}
