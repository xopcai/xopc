package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.AutomationRunSummary
import ai.xopc.mobile.gateway.AutomationSummary
import ai.xopc.mobile.theme.themedCorners
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.DateFormat
import java.util.Date
import java.util.UUID

@Composable
internal fun AutomationFilterButton(filter: String, onSelect: (String) -> Unit) {
  var menuOpen by rememberSaveable { mutableStateOf(false) }
  Box {
    IconButton(onClick = { menuOpen = true }, colors = IconButtonDefaults.iconButtonColors(
      containerColor = MaterialTheme.colorScheme.surface),
      modifier = Modifier.testTag("automation-filter-menu")) {
      ActionIcon(R.drawable.action_filter, contentDescription = stringResource(R.string.automation_filter),
        color = if (filter == "all") MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.primary)
    }
    DropdownMenu(menuOpen, { menuOpen = false }, shape = themedCorners(18)) {
      listOf(
        "all" to R.string.progress_filter_all, "enabled" to R.string.automation_enabled,
        "paused" to R.string.automation_paused, "attention" to R.string.automation_attention,
      ).forEach { (key, label) ->
        val current = filter == key
        DropdownMenuItem(text = { Text(stringResource(label)) },
          trailingIcon = if (current) ({ Text("✓") }) else null,
          modifier = Modifier.testTag("automation-filter-$key").semantics { selected = current },
          onClick = { menuOpen = false; onSelect(key) })
      }
    }
  }
}

@Composable
internal fun AutomationListContent(state: AutomationUiState, gatewayId: String?,
  onRefresh: () -> Unit, onOpen: (String) -> Unit, searchOpen: Boolean, filter: String = "all",
  onEdit: (String) -> Unit = {}, onToggle: (String, String) -> Unit = { _, _ -> },
  onDelete: (String, String) -> Unit = { _, _ -> }, onSchedule: (String) -> Unit = {}) {
  var search by rememberSaveable(gatewayId, searchOpen) { mutableStateOf("") }
  val query = search.trim()
  val shown = state.items.filter { item ->
    (item.name.contains(query, ignoreCase = true) || item.description.contains(query, ignoreCase = true)
      || item.instruction.contains(query, ignoreCase = true)) && when (filter) {
      "enabled" -> item.enabled
      "paused" -> !item.enabled
      "attention" -> item.lastRunStatus in setOf("failed", "timeout", "timed_out")
      else -> true
    }
  }
  Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    if (searchOpen) OutlinedTextField(search, { search = it },
      modifier = Modifier.fillMaxWidth().then(searchInputFocus()).testTag("automation-search"),
      singleLine = true, placeholder = { Text(stringResource(R.string.progress_search)) })
    LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp),
      contentPadding = PaddingValues(bottom = 12.dp)) {
      if (state.listLoading && state.items.isEmpty()) item {
        BrandLoadingPanel(modifier = Modifier.testTag("automation-list-loading"))
      }
      if (state.listError) item { OutlinedButton(onClick = onRefresh,
        modifier = Modifier.testTag("automation-list-retry")) {
        Text(stringResource(R.string.progress_load_failed))
      } }
      if (state.actionError || state.deleteError) item {
        Text(stringResource(if (state.deleteError) R.string.automation_delete_error else R.string.automation_action_error),
          color = MaterialTheme.colorScheme.error)
      }
      items(shown, key = { it.id }) { item ->
        AutomationCard(item, onOpen, onEdit, onToggle, onDelete, state.actionBusy || state.deleteBusy)
      }
      if (state.listLoaded && !state.listError) {
        if (filter == "all" && query.isBlank()) item {
          AutomationIdeas(showIntro = state.items.isEmpty(), onSelect = onSchedule)
        } else if (shown.isEmpty()) item { Text(stringResource(R.string.progress_no_matches)) }
      }
    }
    Button(onClick = { onSchedule("") }, modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)
      .testTag("automation-create")) {
      Text(stringResource(R.string.automation_new))
    }
  }
}

@Composable
internal fun AutomationEditContent(item: AutomationSummary, name: String, onNameChange: (String) -> Unit,
  instruction: String, onInstructionChange: (String) -> Unit, cron: String,
  onCronChange: (String) -> Unit, busy: Boolean, error: Boolean, onSave: () -> Unit) {
  val valid = name.trim().isNotEmpty() && name.trim().length <= 200 &&
    instruction.trim().isNotEmpty() && instruction.trim().length <= 50000 &&
    cron.trim().isNotEmpty() && cron.trim().length <= 256
  val changed = name != item.name || instruction != item.instruction || cron != item.schedule
  var advancedSchedule by rememberSaveable(item.id) { mutableStateOf(false) }
  Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    OutlinedTextField(name, { onNameChange(it.take(200)) },
      label = { Text(stringResource(R.string.automation_name)) }, readOnly = !item.canEditDetails,
      singleLine = true, modifier = Modifier.fillMaxWidth().testTag("automation-edit-name"))
    OutlinedTextField(instruction, { onInstructionChange(it.take(50000)) },
      label = { Text(stringResource(R.string.automation_instruction)) }, readOnly = !item.canEditDetails,
      minLines = 4, modifier = Modifier.fillMaxWidth().testTag("automation-edit-instruction"))
    Text(automationScheduleLabel(item.copy(schedule = cron)), style = MaterialTheme.typography.bodyLarge)
    TextButton(onClick = { advancedSchedule = !advancedSchedule },
      modifier = Modifier.testTag("automation-edit-advanced")) {
      Text(stringResource(R.string.automation_advanced_schedule))
    }
    if (advancedSchedule) OutlinedTextField(cron, { onCronChange(it.take(256)) },
      label = { Text(stringResource(R.string.automation_cron)) },
      singleLine = true, modifier = Modifier.fillMaxWidth().testTag("automation-edit-cron"))
    if (!item.canEditDetails) Text(stringResource(R.string.automation_managed_schedule_only),
      style = MaterialTheme.typography.bodySmall)
    if (error) Text(stringResource(R.string.automation_edit_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("automation-edit-error"))
    Button(onClick = onSave, enabled = valid && changed && !busy,
      modifier = Modifier.fillMaxWidth().testTag("automation-edit-save")) {
      Text(stringResource(R.string.automation_save))
    }
  }
}

private val fixedCronTimeField = Regex("[0-9]{1,2}")
private val cronWhitespace = Regex("""\s+""")

@Composable
private fun automationScheduleLabel(item: AutomationSummary): String {
  item.onceAtMs?.let { return stringResource(R.string.automation_once_at, formatAutomationTime(it)) }
  item.intervalMs?.takeIf { it > 0 }?.let { interval ->
    if (interval % 3_600_000 == 0L) return stringResource(R.string.automation_every_hours, interval / 3_600_000)
    if (interval % 60_000 == 0L) return stringResource(R.string.automation_every_minutes, interval / 60_000)
  }
  if (item.triggerKind == "manual") return stringResource(R.string.automation_manual)
  val fields = item.schedule.trim().split(cronWhitespace)
  val custom = stringResource(R.string.automation_custom_schedule)
  if (fields.size != 5 || fields[3] != "*") return custom
  val (minutes, hours, day) = fields
  val weekday = fields[4]
  if (fields.drop(1).all { it == "*" } && minutes.startsWith("*/")) {
    val interval = minutes.drop(2).toIntOrNull()
    if (interval != null && interval in 1..59 && 60 % interval == 0) {
      return stringResource(R.string.automation_every_minutes, interval)
    }
  }
  if (minutes == "0" && day == "*" && weekday == "*" && hours.startsWith("*/")) {
    val interval = hours.drop(2).toIntOrNull()
    if (interval != null && interval in 1..23 && 24 % interval == 0) {
      return stringResource(R.string.automation_every_hours, interval)
    }
  }
  if (!fixedCronTimeField.matches(minutes) || !fixedCronTimeField.matches(hours) ||
    minutes.toInt() !in 0..59 || hours.toInt() !in 0..23) return custom
  val time = hours.padStart(2, '0') + ":" + minutes.padStart(2, '0')
  if (day == "*" && weekday == "*") return stringResource(R.string.automation_daily_at, time)
  if (day == "*" && weekday == "1-5") return stringResource(R.string.automation_workday_at, time)
  val week = weekday.toIntOrNull()
  if (day == "*" && weekday.length == 1 && week != null && week in 0..7) {
    val label = java.text.DateFormatSymbols.getInstance(LocalConfiguration.current.locales[0]).shortWeekdays[week % 7 + 1]
    return stringResource(R.string.automation_weekly_at, label, time)
  }
  val monthDay = day.toIntOrNull()
  if (weekday == "*" && fixedCronTimeField.matches(day) && monthDay != null && monthDay in 1..31) {
    return stringResource(R.string.automation_monthly_at, monthDay, time)
  }
  return custom
}

@Composable
private fun AutomationCard(item: AutomationSummary, onOpen: (String) -> Unit, onEdit: (String) -> Unit,
  onToggle: (String, String) -> Unit, onDelete: (String, String) -> Unit, busy: Boolean) {
  Box(Modifier.fillMaxWidth()) {
    Card(onClick = { onOpen(item.id) }, shape = themedCorners(18),
      colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
      modifier = Modifier.fillMaxWidth().testTag("automation-${item.id}")) {
      Column(modifier = Modifier.padding(start = 16.dp, end = 52.dp, top = 14.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(stringResource(if (item.enabled) R.string.automation_enabled else R.string.automation_paused),
          style = MaterialTheme.typography.labelMedium, color = if (item.enabled) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurfaceVariant)
        Text(item.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
          maxLines = 2, overflow = TextOverflow.Ellipsis)
        val summary = item.description.ifBlank { item.instruction }
        if (summary.isNotBlank()) Text(summary, maxLines = 3, overflow = TextOverflow.Ellipsis,
          style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(automationScheduleLabel(item), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          item.nextRunAtMs?.takeIf { item.enabled }?.let {
            Text(formatAutomationTime(it), style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    if (item.updatedAtMs > 0 && (item.canEditSchedule || item.canToggle || item.canDelete)) {
      Box(Modifier.align(Alignment.TopEnd).padding(4.dp)) {
        AutomationCardMenu(item, busy, onEdit, onToggle, onDelete)
      }
    }
  }
}

@Composable
private fun AutomationCardMenu(item: AutomationSummary, busy: Boolean, onEdit: (String) -> Unit,
  onToggle: (String, String) -> Unit, onDelete: (String, String) -> Unit) {
  var open by rememberSaveable(item.id) { mutableStateOf(false) }
  var confirming by rememberSaveable(item.id) { mutableStateOf(false) }
  val deleteKey = rememberSaveable(item.id, item.updatedAtMs) { UUID.randomUUID().toString() }
  Box {
    IconButton(onClick = { open = true }, enabled = !busy, modifier = Modifier.testTag("automation-card-menu-${item.id}")) {
      ActionIcon(R.drawable.action_more_horizontal, contentDescription = stringResource(R.string.automation_more))
    }
    DropdownMenu(open, { open = false }, shape = themedCorners(18)) {
      if (item.canEditSchedule) DropdownMenuItem(text = { Text(stringResource(R.string.automation_edit)) },
        modifier = Modifier.testTag("automation-card-edit"), onClick = { open = false; onEdit(item.id) })
      if (item.canToggle) DropdownMenuItem(text = {
        Text(stringResource(if (item.enabled) R.string.automation_pause else R.string.automation_resume))
      }, modifier = Modifier.testTag("automation-card-toggle"),
        onClick = { open = false; onToggle(item.id, if (item.enabled) "pause" else "resume") })
      if (item.canDelete) DropdownMenuItem(text = {
        Text(stringResource(R.string.automation_delete), color = MaterialTheme.colorScheme.error)
      }, modifier = Modifier.testTag("automation-card-delete"), onClick = { open = false; confirming = true })
    }
  }
  if (confirming) AlertDialog(onDismissRequest = { confirming = false },
    title = { Text(stringResource(R.string.automation_delete)) },
    text = { Text(stringResource(R.string.automation_delete_confirm)) },
    confirmButton = { TextButton(onClick = { confirming = false; onDelete(item.id, deleteKey) },
      modifier = Modifier.testTag("automation-card-delete-confirm")) { Text(stringResource(R.string.progress_confirm)) } },
    dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.progress_cancel)) } })
}

@Composable
internal fun AutomationDetailContent(state: AutomationUiState,
  onRetry: () -> Unit, onOpenRun: (String) -> Unit, onAction: (String) -> Unit = {},
  onEdit: () -> Unit = {}, onDelete: (String) -> Unit = {}) {
  val item = state.detail.takeIf { it?.id == state.selectedId }
  var expanded by rememberSaveable(state.selectedId) { mutableStateOf(false) }
  var confirmRun by rememberSaveable(state.selectedId) { mutableStateOf(false) }
  var confirmDelete by rememberSaveable(state.selectedId) { mutableStateOf(false) }
  val deleteKey = rememberSaveable(state.selectedId) { UUID.randomUUID().toString() }
  LazyColumn(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp),
    contentPadding = PaddingValues(bottom = 20.dp)) {
    if (state.detailLoading && item == null) item {
      BrandLoadingPanel(modifier = Modifier.testTag("automation-detail-loading"))
    }
    if (state.detailError) item { OutlinedButton(onClick = onRetry,
      modifier = Modifier.testTag("automation-detail-retry")) { Text(stringResource(R.string.progress_load_failed)) } }
    if (state.actionError) item { Text(stringResource(R.string.automation_action_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("automation-action-error")) }
    if (state.deleteError) item { Text(stringResource(R.string.automation_delete_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("automation-delete-error")) }
    if (item != null) {
      item {
        Card(modifier = Modifier.fillMaxWidth()) {
          Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(if (item.enabled) R.string.automation_enabled else R.string.automation_paused),
              color = MaterialTheme.colorScheme.primary)
            if (item.description.isNotBlank()) Text(item.description)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              if (item.canRun) Button(onClick = { confirmRun = true }, enabled = !state.actionBusy,
                modifier = Modifier.weight(1f).testTag("automation-run-now")) {
                Text(stringResource(R.string.automation_run_now))
              }
              if (item.canToggle && item.updatedAtMs > 0) OutlinedButton(
                onClick = { onAction(if (item.enabled) "pause" else "resume") },
                enabled = !state.actionBusy,
                modifier = Modifier.weight(1f).testTag("automation-toggle")) {
                Text(stringResource(if (item.enabled) R.string.automation_pause else R.string.automation_resume))
              }
            }
          }
        }
      }
      item { Text(stringResource(R.string.automation_definition), style = MaterialTheme.typography.titleSmall) }
      item {
        Card(modifier = Modifier.fillMaxWidth()) {
          Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(automationScheduleLabel(item))
            item.nextRunAtMs?.let { Text(stringResource(R.string.automation_next_run, formatAutomationTime(it))) }
            item.lastRunAtMs?.let { Text(stringResource(R.string.automation_last_run, formatAutomationTime(it))) }
            item.lastError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (item.instruction.isNotBlank()) {
              MarkdownContent(item.instruction, maxLines = if (expanded) null else 6)
              TextButton(onClick = { expanded = !expanded }, modifier = Modifier.testTag("automation-definition-toggle")) {
                Text(stringResource(if (expanded) R.string.automation_hide_definition
                  else R.string.automation_show_definition))
              }
            }
          }
        }
      }
      if (item.canEditSchedule && item.updatedAtMs > 0) item {
        OutlinedButton(onClick = onEdit, enabled = !state.actionBusy && !state.deleteBusy,
          modifier = Modifier.fillMaxWidth().testTag("automation-edit")) {
          Text(stringResource(R.string.automation_edit))
        }
      }
      item { Text(stringResource(R.string.automation_recent_runs), style = MaterialTheme.typography.titleSmall) }
      if (state.runsError) item { OutlinedButton(onClick = onRetry,
        modifier = Modifier.testTag("automation-runs-retry")) { Text(stringResource(R.string.progress_load_failed)) } }
      if (!state.detailLoading && !state.runsError && state.runs.isEmpty()) item {
        Text(stringResource(R.string.automation_no_runs))
      }
      items(state.runs, key = { it.id }) { run ->
        Card(onClick = { onOpenRun(run.id) }, enabled = !state.actionBusy,
          modifier = Modifier.fillMaxWidth().testTag("automation-run-${run.id}")) {
          Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(runStatusLabel(run.status), style = MaterialTheme.typography.titleMedium)
            Text(run.error ?: run.summary.orEmpty(), maxLines = 2, overflow = TextOverflow.Ellipsis)
          }
        }
      }
      if (item.canDelete && item.updatedAtMs > 0) item {
        TextButton(onClick = { confirmDelete = true }, enabled = !state.deleteBusy && !state.actionBusy,
          modifier = Modifier.fillMaxWidth().testTag("automation-delete")) {
          Text(stringResource(R.string.automation_delete))
        }
      }
    }
  }
  if (confirmRun) AlertDialog(onDismissRequest = { confirmRun = false },
    title = { Text(stringResource(R.string.automation_run_now)) },
    text = { Text(stringResource(R.string.automation_run_confirm)) },
    confirmButton = { TextButton(onClick = { confirmRun = false; onAction("run") },
      modifier = Modifier.testTag("automation-run-confirm")) { Text(stringResource(R.string.progress_confirm)) } },
    dismissButton = { TextButton(onClick = { confirmRun = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
  if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false },
    title = { Text(stringResource(R.string.automation_delete)) },
    text = { Text(stringResource(R.string.automation_delete_confirm)) },
    confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete(deleteKey) },
      modifier = Modifier.testTag("automation-delete-confirm")) {
      Text(stringResource(R.string.progress_confirm))
    } }, dismissButton = { TextButton(onClick = { confirmDelete = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
}

@Composable
internal fun AutomationRunContent(state: AutomationUiState,
  onRetry: () -> Unit, onOpenChat: (String) -> Unit, onOpenAutomation: (String) -> Unit,
  onAction: (String) -> Unit = {}) {
  val run = state.run.takeIf { it?.id == state.selectedRunId }
  var confirmCancel by rememberSaveable(state.selectedRunId) { mutableStateOf(false) }
  LazyColumn(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp),
    contentPadding = PaddingValues(bottom = 20.dp)) {
    if (state.runLoading && run == null) item {
      BrandLoadingPanel(modifier = Modifier.testTag("automation-run-loading"))
    }
    if (state.runError) item { OutlinedButton(onClick = onRetry,
      modifier = Modifier.testTag("automation-run-retry")) { Text(stringResource(R.string.progress_load_failed)) } }
    if (state.runActionError) item { Text(stringResource(R.string.automation_run_action_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("automation-run-action-error")) }
    if (run != null) {
      item {
        Card(modifier = Modifier.fillMaxWidth()) {
          Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(runStatusLabel(run.status),
              style = MaterialTheme.typography.titleLarge.copy(fontSize = 22.sp, lineHeight = 30.sp))
            (run.startedAtMs ?: run.createdAtMs)?.let { Text(formatAutomationTime(it)) }
            run.summary?.takeIf { it.isNotBlank() }?.let {
              MarkdownContent(it, modifier = Modifier.fillMaxWidth().testTag("automation-run-summary"))
            }
            run.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (run.status in setOf("queued", "running", "cancelling")) {
              OutlinedButton(onClick = { confirmCancel = true }, enabled = !state.runActionBusy,
                modifier = Modifier.fillMaxWidth().testTag("automation-cancel-run")) {
                Text(stringResource(R.string.automation_cancel_run))
              }
            } else if (run.status in setOf("failed", "timeout", "cancelled")) {
              Button(onClick = { onAction("rerun") }, enabled = !state.runActionBusy,
                modifier = Modifier.fillMaxWidth().testTag("automation-rerun")) {
                Text(stringResource(R.string.automation_rerun))
              }
            }
          }
        }
      }
      item { Text(stringResource(R.string.automation_result), style = MaterialTheme.typography.titleSmall) }
      run.conversationId?.let { conversationId -> item {
        OutlinedButton(onClick = { onOpenChat(conversationId) },
          modifier = Modifier.fillMaxWidth().testTag("automation-open-chat")) {
          Text(stringResource(R.string.automation_open_chat))
        }
      } }
      item { OutlinedButton(onClick = { onOpenAutomation(run.automationId) },
        modifier = Modifier.fillMaxWidth().testTag("automation-view-definition")) {
        Text(stringResource(R.string.automation_view_definition))
      } }
      item { Text(stringResource(R.string.automation_timeline), style = MaterialTheme.typography.titleSmall) }
      if (state.eventsError) item { OutlinedButton(onClick = onRetry,
        modifier = Modifier.testTag("automation-events-retry")) { Text(stringResource(R.string.progress_load_failed)) } }
      if (!state.runLoading && !state.eventsError && state.events.isEmpty()) item {
        Text(stringResource(R.string.automation_no_events))
      }
      items(state.events, key = { it.id }) { event ->
        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
          Text(event.message, style = MaterialTheme.typography.bodyMedium)
          event.createdAtMs?.let { Text(formatAutomationTime(it),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
      }
    }
  }
  if (confirmCancel) AlertDialog(onDismissRequest = { confirmCancel = false },
    title = { Text(stringResource(R.string.automation_cancel_run)) },
    text = { Text(stringResource(R.string.automation_cancel_confirm)) },
    confirmButton = { TextButton(onClick = { confirmCancel = false; onAction("cancel") },
      modifier = Modifier.testTag("automation-cancel-confirm")) {
      Text(stringResource(R.string.progress_confirm))
    } }, dismissButton = { TextButton(onClick = { confirmCancel = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
}

private fun formatAutomationTime(time: Long): String = DateFormat.getDateTimeInstance().format(Date(time))
