package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.AutomationRunSummary
import ai.xopc.mobile.gateway.AutomationSummary
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.text.DateFormat
import java.util.Date
import java.util.UUID

@Composable
internal fun AutomationListContent(state: AutomationUiState, gatewayId: String?,
  onRefresh: () -> Unit, onOpen: (String) -> Unit, onCreate: () -> Unit = {}) {
  var search by rememberSaveable(gatewayId) { mutableStateOf("") }
  var query by rememberSaveable(gatewayId) { mutableStateOf("") }
  var filter by rememberSaveable(gatewayId) { mutableStateOf("all") }
  val shown = state.items.filter { item ->
    item.name.contains(query, ignoreCase = true) && when (filter) {
      "enabled" -> item.enabled
      "paused" -> !item.enabled
      else -> true
    }
  }
  Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedTextField(search, { search = it }, modifier = Modifier.weight(1f).testTag("automation-search"),
        singleLine = true, placeholder = { Text(stringResource(R.string.progress_search)) })
      TextButton(onClick = { query = search.trim(); onRefresh() }, enabled = !state.listLoading,
        modifier = Modifier.testTag("automation-refresh")) { Text(stringResource(R.string.progress_refresh)) }
    }
    Button(onClick = onCreate, modifier = Modifier.fillMaxWidth().testTag("automation-create")) {
      Text(stringResource(R.string.automation_new))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      FilterChip(filter == "all", { filter = "all" }, label = { Text(stringResource(R.string.progress_filter_all)) },
        modifier = Modifier.testTag("automation-filter-all"))
      FilterChip(filter == "enabled", { filter = "enabled" },
        label = { Text(stringResource(R.string.automation_enabled)) },
        modifier = Modifier.testTag("automation-filter-enabled"))
      FilterChip(filter == "paused", { filter = "paused" },
        label = { Text(stringResource(R.string.automation_paused)) },
        modifier = Modifier.testTag("automation-filter-paused"))
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 20.dp)) {
      item { Text(stringResource(R.string.automation_list_hint, state.items.size),
        style = MaterialTheme.typography.bodySmall) }
      if (state.listLoading && state.items.isEmpty()) item {
        BrandLoadingPanel(modifier = Modifier.testTag("automation-list-loading"))
      }
      if (state.listError) item { OutlinedButton(onClick = onRefresh,
        modifier = Modifier.testTag("automation-list-retry")) {
        Text(stringResource(R.string.progress_load_failed))
      } }
      if (!state.listLoading && !state.listError && shown.isEmpty()) item {
        Text(stringResource(if (state.items.isEmpty()) R.string.automation_empty else R.string.progress_no_matches))
      }
      items(shown, key = { it.id }) { item -> AutomationCard(item, onOpen) }
    }
  }
}

@Composable
internal fun AutomationCreateContent(name: String, onNameChange: (String) -> Unit,
  instruction: String, onInstructionChange: (String) -> Unit, cron: String,
  onCronChange: (String) -> Unit, busy: Boolean, error: Boolean, onSave: () -> Unit) {
  val valid = name.trim().isNotEmpty() && name.trim().length <= 200 &&
    instruction.trim().isNotEmpty() && instruction.trim().length <= 50000 &&
    cron.trim().isNotEmpty() && cron.trim().length <= 256
  Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    OutlinedTextField(name, { onNameChange(it.take(200)) }, label = { Text(stringResource(R.string.automation_name)) },
      singleLine = true, modifier = Modifier.fillMaxWidth().testTag("automation-create-name"))
    OutlinedTextField(instruction, { onInstructionChange(it.take(50000)) },
      label = { Text(stringResource(R.string.automation_instruction)) },
      minLines = 4, modifier = Modifier.fillMaxWidth().testTag("automation-create-instruction"))
    OutlinedTextField(cron, { onCronChange(it.take(256)) },
      label = { Text(stringResource(R.string.automation_cron)) },
      singleLine = true, modifier = Modifier.fillMaxWidth().testTag("automation-create-cron"))
    if (error) Text(stringResource(R.string.automation_create_error),
      color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("automation-create-error"))
    Button(onClick = onSave, enabled = valid && !busy,
      modifier = Modifier.fillMaxWidth().testTag("automation-create-save")) {
      Text(stringResource(R.string.automation_save))
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
  Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    OutlinedTextField(name, { onNameChange(it.take(200)) },
      label = { Text(stringResource(R.string.automation_name)) }, readOnly = !item.canEditDetails,
      singleLine = true, modifier = Modifier.fillMaxWidth().testTag("automation-edit-name"))
    OutlinedTextField(instruction, { onInstructionChange(it.take(50000)) },
      label = { Text(stringResource(R.string.automation_instruction)) }, readOnly = !item.canEditDetails,
      minLines = 4, modifier = Modifier.fillMaxWidth().testTag("automation-edit-instruction"))
    OutlinedTextField(cron, { onCronChange(it.take(256)) },
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

@Composable
private fun AutomationCard(item: AutomationSummary, onOpen: (String) -> Unit) {
  Card(onClick = { onOpen(item.id) }, modifier = Modifier.fillMaxWidth().testTag("automation-${item.id}")) {
    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Text(item.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      Text(stringResource(if (item.enabled) R.string.automation_enabled else R.string.automation_paused),
        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
      if (item.description.isNotBlank()) Text(item.description, maxLines = 2,
        overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
      Text(item.schedule.ifBlank { stringResource(R.string.automation_manual) },
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      item.lastRunStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
  }
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
            Text(item.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
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
            Text(item.schedule.ifBlank { stringResource(R.string.automation_manual) })
            item.nextRunAtMs?.let { Text(stringResource(R.string.automation_next_run, formatAutomationTime(it))) }
            item.lastRunAtMs?.let { Text(stringResource(R.string.automation_last_run, formatAutomationTime(it))) }
            item.lastError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (item.instruction.isNotBlank()) {
              Text(item.instruction, maxLines = if (expanded) Int.MAX_VALUE else 6,
                overflow = TextOverflow.Ellipsis)
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
            Text(run.status, style = MaterialTheme.typography.titleMedium)
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
            Text(run.status, style = MaterialTheme.typography.headlineSmall)
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
          Text(event.message)
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
