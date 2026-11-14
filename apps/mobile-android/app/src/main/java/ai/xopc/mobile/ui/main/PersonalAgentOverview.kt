package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.AutomationSummary
import ai.xopc.mobile.gateway.PersonalAgentRecord
import ai.xopc.mobile.gateway.PersonalDelivery
import ai.xopc.mobile.gateway.PersonalDeliveryPage
import ai.xopc.mobile.gateway.PersonalOverviewAccess
import ai.xopc.mobile.gateway.PersonalWork
import ai.xopc.mobile.gateway.PersonalWorkPage
import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import java.text.DateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import java.time.DayOfWeek
import java.util.Date

internal data class PersonalOverviewList<T>(val value: T? = null, val loading: Boolean = true, val failed: Boolean = false)

@Composable
internal fun PersonalAgentOverview(access: PersonalOverviewAccess?, agent: PersonalAgentRecord,
  avatar: Bitmap?, clarification: String?, onClose: () -> Unit, onEdit: () -> Unit,
  onTask: (String) -> Unit, onSchedule: (String) -> Unit, onOpenSchedule: (String) -> Unit,
  onDelivery: (PersonalDelivery) -> Unit, modifier: Modifier = Modifier) {
  var library by rememberSaveable(agent.conversationId) { mutableStateOf(false) }
  var work by remember(agent.conversationId) { mutableStateOf(PersonalOverviewList<PersonalWorkPage>()) }
  var schedules by remember(agent.conversationId) { mutableStateOf(PersonalOverviewList<List<AutomationSummary>>()) }
  var deliveries by remember(agent.conversationId) { mutableStateOf(PersonalOverviewList<PersonalDeliveryPage>()) }
  var workOffset by remember(agent.conversationId) { mutableIntStateOf(0) }
  var deliveryOffset by remember(agent.conversationId) { mutableIntStateOf(0) }
  var workRevision by remember { mutableIntStateOf(0) }
  var scheduleRevision by remember { mutableIntStateOf(0) }
  var deliveryRevision by remember { mutableIntStateOf(0) }

  LaunchedEffect(access, agent.conversationId, workRevision, workOffset) {
    val previous = work.value
    work = PersonalOverviewList(previous)
    try {
      val page = runInterruptible(Dispatchers.IO) { checkNotNull(access).work(workOffset) }
      val history = if (workOffset == 0) page.history else previous?.history.orEmpty() + page.history
      work = PersonalOverviewList(page.copy(history = history.distinctBy { it.id },
        total = if (page.history.isEmpty()) history.size else page.total), loading = false)
    } catch (e: CancellationException) { throw e }
    catch (_: Exception) { work = PersonalOverviewList(previous, loading = false, failed = true) }
  }
  LaunchedEffect(access, agent.conversationId, scheduleRevision) {
    val previous = schedules.value
    schedules = PersonalOverviewList(previous)
    try {
      schedules = PersonalOverviewList(runInterruptible(Dispatchers.IO) { checkNotNull(access).schedules() }, loading = false)
    } catch (e: CancellationException) { throw e }
    catch (_: Exception) { schedules = PersonalOverviewList(previous, loading = false, failed = true) }
  }
  LaunchedEffect(access, agent.conversationId, library, deliveryRevision, deliveryOffset) {
    if (!library || (deliveries.value != null && !deliveries.loading && !deliveries.failed &&
        (deliveries.value?.nextOffset ?: -1) != deliveryOffset)) return@LaunchedEffect
    val previous = deliveries.value
    deliveries = PersonalOverviewList(previous)
    try {
      val page = runInterruptible(Dispatchers.IO) { checkNotNull(access).deliveries(deliveryOffset, agent.conversationId) }
      val items = if (deliveryOffset == 0) page.items else previous?.items.orEmpty() + page.items
      deliveries = PersonalOverviewList(page.copy(items = items.distinctBy { it.id }), loading = false)
    } catch (e: CancellationException) { throw e }
    catch (_: Exception) { deliveries = PersonalOverviewList(previous, loading = false, failed = true) }
  }
  PersonalOverviewContent(agent, avatar, clarification, library, { library = it }, work, schedules, deliveries,
    onClose, onEdit, onTask, onSchedule, onOpenSchedule, onDelivery,
    onWorkMore = {
      if (work.failed) workRevision++ else workOffset = work.value?.history?.size ?: 0
    }, onScheduleRetry = { scheduleRevision++ }, onDeliveryMore = {
      if (deliveries.failed) deliveryRevision++ else deliveries.value?.nextOffset?.let { deliveryOffset = it }
    }, modifier = modifier)
}

@Composable
internal fun PersonalOverviewContent(agent: PersonalAgentRecord, avatar: Bitmap?, clarification: String?,
  library: Boolean, onTab: (Boolean) -> Unit, work: PersonalOverviewList<PersonalWorkPage>,
  schedules: PersonalOverviewList<List<AutomationSummary>>, deliveries: PersonalOverviewList<PersonalDeliveryPage>,
  onClose: () -> Unit, onEdit: () -> Unit, onTask: (String) -> Unit, onSchedule: (String) -> Unit,
  onOpenSchedule: (String) -> Unit, onDelivery: (PersonalDelivery) -> Unit,
  onWorkMore: () -> Unit, onScheduleRetry: () -> Unit, onDeliveryMore: () -> Unit, modifier: Modifier) {
  val density = LocalDensity.current
  val maxCollapse = with(density) { 60.dp.toPx() }
  val collapse = rememberSaveable(agent.conversationId) { mutableFloatStateOf(0f) }
  val scroll = remember(maxCollapse) {
    object : NestedScrollConnection {
      override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        val before = collapse.floatValue
        val next = (before - available.y).coerceIn(0f, maxCollapse)
        if (next != before) collapse.floatValue = next
        return Offset(0f, before - next)
      }
    }
  }
  val current = work.value?.current.orEmpty()
  val needsAttention = current.filter { it.needsAttention }
  val active = current.filter { !it.needsAttention && !it.ended }
  val attention = needsAttention.size + if (clarification != null) 1 else 0
  val running = active.count { it.operationalState in setOf("running", "verifying") }
  Column(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
    .padding(horizontal = 16.dp).testTag("personal-overview")) {
    PersonalOverviewHeader(agent, avatar, attention, running, library, collapse, maxCollapse, onTab, onClose, onEdit)
    key(library) {
      LazyColumn(Modifier.fillMaxWidth().weight(1f).nestedScroll(scroll)
        .testTag(if (library) "personal-overview-library-list" else "personal-overview-task-list"),
        contentPadding = PaddingValues(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        if (library) {
          if (deliveries.loading && deliveries.value == null) item { BrandLoadingPanel() }
          items(deliveries.value?.items.orEmpty(), key = { it.id }) { delivery ->
            OverviewRow(delivery.title, delivery.taskTitle ?: stringResource(R.string.personal_overview_source),
              R.drawable.tab_notes, "personal-overview-delivery-${delivery.id}") { onDelivery(delivery) }
          }
          if (deliveries.value?.items?.isEmpty() == true) item {
            Text(stringResource(R.string.personal_overview_no_deliveries), Modifier.padding(12.dp),
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          if (deliveries.failed || deliveries.value?.nextOffset != null) item {
            TextButton(onClick = onDeliveryMore, enabled = !deliveries.loading) {
              Text(stringResource(if (deliveries.failed) R.string.progress_refresh else R.string.progress_load_more))
            }
          }
        } else {
          if (work.loading && work.value == null) item { BrandLoadingPanel() }
          if (attention > 0) item { OverviewSection(stringResource(R.string.personal_overview_attention)) }
          clarification?.let { question ->
            item("clarification") { OverviewRow(question, stringResource(R.string.personal_overview_attention),
              R.drawable.tab_progress, "personal-overview-clarification", true, onClose) }
          }
          items(needsAttention, key = { it.id }) { task -> OverviewTaskRow(task, onTask) }
          if (active.isNotEmpty()) item { OverviewSection(stringResource(R.string.personal_overview_current)) }
          items(active, key = { it.id }) { task -> OverviewTaskRow(task, onTask) }
          item("schedules") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.SpaceBetween) {
              OverviewSection(stringResource(R.string.personal_overview_schedules))
              TextButton(onClick = { onSchedule("") }, modifier = Modifier.testTag("personal-overview-new-schedule")) {
                Text(stringResource(R.string.personal_overview_new_schedule))
              }
            }
          }
          if (schedules.loading && schedules.value == null) item { BrandLoadingIndicator() }
          if (schedules.failed) item { TextButton(onClick = onScheduleRetry) { Text(stringResource(R.string.progress_refresh)) } }
          if (schedules.value?.isEmpty() == true && !schedules.loading && !schedules.failed)
            item { AutomationIdeas(onSelect = onSchedule) }
          items(schedules.value.orEmpty(), key = { "schedule-${it.id}" }) { task ->
            val description = if (!task.enabled) stringResource(R.string.automation_paused) else
              task.nextRunAtMs?.let { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it)) }
                ?: stringResource(R.string.personal_overview_repeats)
            OverviewRow(task.name, description, R.drawable.action_clock, "personal-overview-schedule-${task.id}") {
              onOpenSchedule(task.id)
            }
          }
          val included = (needsAttention + active).map { it.id }.toSet()
          val history = (current.filter { it.ended } + work.value?.history.orEmpty())
            .distinctBy { it.id }.filterNot { it.id in included }.sortedByDescending { it.updatedAt }
          val zone = ZoneId.systemDefault()
          val today = LocalDate.now(zone)
          val monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
          history.groupBy {
            val date = Instant.ofEpochMilli(it.updatedAt).atZone(zone).toLocalDate()
            when {
              date >= today -> R.string.personal_overview_today
              date >= monday -> R.string.personal_overview_week
              else -> R.string.personal_overview_earlier
            }
          }.forEach { (label, tasks) ->
            item("history-$label") { OverviewSection(stringResource(label)) }
            items(tasks, key = { it.id }) { task -> OverviewTaskRow(task, onTask) }
          }
          if (work.failed || (work.value?.let { it.history.size < it.total } == true)) item {
            TextButton(onClick = onWorkMore, enabled = !work.loading) {
              Text(stringResource(if (work.failed) R.string.progress_refresh else R.string.progress_load_more))
            }
          }
        }
      }
    }
  }
}

@Composable
private fun PersonalOverviewHeader(agent: PersonalAgentRecord, avatar: Bitmap?, attention: Int, running: Int,
  library: Boolean, collapse: FloatState, maxCollapse: Float, onTab: (Boolean) -> Unit, onClose: () -> Unit, onEdit: () -> Unit) {
  val extent = (116 - 48 * (collapse.floatValue / maxCollapse).coerceIn(0f, 1f)).dp
  Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
    IconButton(onClick = onClose, modifier = Modifier.align(Alignment.End).testTag("personal-overview-close")) {
      Icon(painterResource(R.drawable.action_close), stringResource(R.string.assistant_close))
    }
    Box(Modifier.size(extent).testTag("personal-overview-avatar")) {
      PersonalAgentAvatar(avatar, agent.appearance, extent, active = true)
      FilledTonalIconButton(onClick = onEdit, modifier = Modifier.align(Alignment.BottomEnd)
        .size(40.dp).testTag("personal-overview-edit")) {
        Icon(painterResource(R.drawable.action_new_chat), stringResource(R.string.personal_overview_edit), Modifier.size(18.dp))
      }
    }
    Text(agent.displayName, Modifier.padding(top = 5.dp), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.headlineSmall,
      maxLines = 1, overflow = TextOverflow.Ellipsis)
    if (attention > 0 || running > 0) Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Box(Modifier.size(6.dp).background(if (attention > 0) androidx.compose.ui.graphics.Color(0xFFFFB55C) else MaterialTheme.colorScheme.primary, CircleShape))
      Text(if (attention > 0) stringResource(R.string.progress_attention_count, attention)
        else stringResource(R.string.personal_overview_running, running),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp)
      .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(28.dp)).padding(4.dp),
      horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      PersonalOverviewTab(Modifier.weight(1f), R.drawable.action_task_list,
        stringResource(R.string.progress_tasks) + if (attention > 0) "  $attention" else "",
        !library, "personal-overview-tasks-tab") { onTab(false) }
      PersonalOverviewTab(Modifier.weight(1f), R.drawable.tab_notes, stringResource(R.string.personal_overview_library),
        library, "personal-overview-library-tab") { onTab(true) }
    }
  }
}

@Composable
private fun PersonalOverviewTab(modifier: Modifier, icon: Int, label: String, selected: Boolean, tag: String, onClick: () -> Unit) {
  Surface(onClick = onClick, selected = selected, modifier = modifier.testTag(tag), shape = CircleShape,
    color = if (selected) MaterialTheme.colorScheme.surfaceContainerHighest else androidx.compose.ui.graphics.Color.Transparent) {
    Row(Modifier.height(44.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterHorizontally)) {
      Icon(painterResource(icon), null, Modifier.size(17.dp))
      Text(label, style = MaterialTheme.typography.labelLarge)
    }
  }
}

@Composable
private fun OverviewSection(title: String) {
  Text(title, Modifier.padding(horizontal = 8.dp, vertical = 6.dp), style = MaterialTheme.typography.labelLarge,
    color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun OverviewTaskRow(task: PersonalWork, onTask: (String) -> Unit) {
  val status = when {
    task.needsAttention -> stringResource(R.string.personal_overview_attention)
    task.operationalState == "paused" -> stringResource(R.string.automation_paused)
    else -> progressPhaseLabel(task.phase)
  }
  val stamp = task.updatedAt.takeIf { it > 0 }?.let { DateFormat.getDateInstance(DateFormat.SHORT).format(Date(it)) }
  OverviewRow(task.title, listOfNotNull(status, stamp).joinToString(" · "), R.drawable.tab_progress,
    "personal-overview-task-${task.id}", task.needsAttention) { onTask(task.id) }
}

@Composable
private fun OverviewRow(title: String, description: String, icon: Int, tag: String, attention: Boolean = false, onClick: () -> Unit) {
  Surface(onClick, Modifier.fillMaxWidth().testTag(tag), shape = RoundedCornerShape(12.dp),
    color = androidx.compose.ui.graphics.Color.Transparent) {
    Row(Modifier.heightIn(min = 52.dp).padding(horizontal = 8.dp, vertical = 5.dp),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      Icon(painterResource(icon), null, Modifier.size(19.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          if (attention) Box(Modifier.size(6.dp).background(androidx.compose.ui.graphics.Color(0xFFFFB55C), CircleShape))
          Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      Icon(painterResource(R.drawable.action_chevron_right), null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}
