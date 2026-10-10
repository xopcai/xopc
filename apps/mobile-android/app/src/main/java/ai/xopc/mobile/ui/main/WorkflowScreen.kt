package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.WorkflowDetail
import ai.xopc.mobile.gateway.WorkflowRun
import ai.xopc.mobile.gateway.WorkflowStep
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

@Composable
internal fun WorkflowScreen(gatewayId: String, onBack: () -> Unit,
  list: suspend () -> List<WorkflowRun>, detail: suspend (String) -> WorkflowDetail,
  cancel: suspend (String) -> Unit, onCreateWithChat: () -> Unit) {
  var selectedId by rememberSaveable(gatewayId) { mutableStateOf<String?>(null) }
  var runs by remember(gatewayId) { mutableStateOf<List<WorkflowRun>>(emptyList()) }
  var selected by remember(gatewayId) { mutableStateOf<WorkflowDetail?>(null) }
  var loading by remember(gatewayId) { mutableStateOf(true) }
  var error by remember(gatewayId) { mutableStateOf(false) }
  var cancelOpen by remember(gatewayId) { mutableStateOf(false) }
  var cancelling by remember(gatewayId) { mutableStateOf(false) }
  var revision by remember(gatewayId) { mutableIntStateOf(0) }
  val scope = rememberCoroutineScope()
  fun back() { if (selectedId != null) selectedId = null else onBack() }
  BackHandler { back() }

  LaunchedEffect(gatewayId, selectedId, revision) {
    loading = true; error = false
    try {
      if (selectedId == null) {
        selected = null
        runs = list()
      } else selected = detail(requireNotNull(selectedId))
    } catch (failure: CancellationException) { throw failure }
    catch (_: Exception) { error = true }
    finally { loading = false }
  }
  LaunchedEffect(gatewayId, selectedId, selected?.run?.status) {
    if (selectedId != null && selected?.run?.status in setOf("queued", "running")) {
      delay(4_000)
      revision++
    }
  }

  Column(modifier = Modifier.fillMaxSize().testTag("workflow-screen"),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
      horizontalArrangement = Arrangement.SpaceBetween) {

      Text(if (selectedId == null) stringResource(R.string.workflow_recent)
        else stringResource(R.string.workflow_overview),
        style = MaterialTheme.typography.titleSmall,
        modifier = Modifier.weight(1f).padding(top = 12.dp))
      TextButton(onClick = { revision++ }, enabled = !loading,
        modifier = Modifier.testTag("workflow-refresh")) {
        Text(stringResource(R.string.workflow_refresh))
      }
    }
    if (selectedId == null) {
      Button(onClick = onCreateWithChat, modifier = Modifier.padding(horizontal = 16.dp)
        .testTag("workflow-new-chat")) { Text(stringResource(R.string.workflow_new)) }
    }
    if (loading && (selectedId == null && runs.isEmpty() || selectedId != null && selected == null))
      BrandLoadingPanel(modifier = Modifier.testTag("workflow-loading"))
    if (error) Text(stringResource(R.string.workflow_load_error),
      modifier = Modifier.padding(horizontal = 16.dp).testTag("workflow-error"),
      color = MaterialTheme.colorScheme.error)
    LazyColumn(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      if (selectedId == null) {
        if (!loading && !error && runs.isEmpty()) item {
          Text(stringResource(R.string.workflow_empty), modifier = Modifier.padding(16.dp))
        }
        items(runs, key = { it.id }) { run ->
          Card(onClick = { selectedId = run.id }, modifier = Modifier.fillMaxWidth()
            .padding(horizontal = 16.dp).testTag("workflow-run-${run.id}")) {
            Column(modifier = Modifier.padding(16.dp)) {
              Text(run.title, style = MaterialTheme.typography.titleMedium)
              Text(runStatusLabel(run.status), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      } else selected?.takeIf { it.run.id == selectedId }?.let { record ->
        item {
          Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Text(record.run.title, style = MaterialTheme.typography.titleLarge)
              Text(runStatusLabel(record.run.status))
              Text(stringResource(R.string.workflow_progress,
                record.agents.count { it.status in setOf("done", "succeeded") }, record.agents.size))
              if (record.canCancel) Button(onClick = { cancelOpen = true },
                enabled = !cancelling, modifier = Modifier.testTag("workflow-cancel")) {
                Text(stringResource(R.string.workflow_cancel))
              }
            }
          }
        }
        if (record.run.goal.isNotBlank()) item { WorkflowTextSection(R.string.workflow_goal, record.run.goal) }
        if (record.run.result.isNotBlank()) item { WorkflowTextSection(R.string.workflow_result, record.run.result) }
        if (record.phases.isNotEmpty()) item { WorkflowTextSection(R.string.workflow_phases, "") }
        items(record.phases, key = { "phase-${it.id}" }) { WorkflowStepCard(it) }
        if (record.agents.isNotEmpty()) item { WorkflowTextSection(R.string.workflow_agents, "") }
        items(record.agents, key = { "agent-${it.id}" }) { WorkflowStepCard(it) }
      }
    }
  }
  if (cancelOpen) AlertDialog(onDismissRequest = { cancelOpen = false },
    title = { Text(stringResource(R.string.workflow_cancel)) },
    text = { Text(stringResource(R.string.workflow_cancel_confirm)) },
    confirmButton = { TextButton(onClick = {
      val id = selectedId ?: return@TextButton
      cancelOpen = false; cancelling = true
      scope.launch {
        try { cancel(id); revision++ }
        catch (_: Exception) { error = true }
        finally { cancelling = false }
      }
    }, modifier = Modifier.testTag("workflow-cancel-confirm")) {
      Text(stringResource(R.string.workflow_cancel))
    } },
    dismissButton = { TextButton(onClick = { cancelOpen = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
}

@Composable
private fun WorkflowTextSection(label: Int, content: String) {
  Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
    Text(stringResource(label), style = MaterialTheme.typography.titleMedium)
    if (content.isNotBlank()) MarkdownContent(content,
      modifier = Modifier.fillMaxWidth().testTag("workflow-markdown-$label"))
  }
}

@Composable
private fun WorkflowStepCard(step: WorkflowStep) {
  val summary = if (step.error.isNotBlank()) step.error else if (step.preview.isNotBlank()) step.preview
    else runStatusLabel(step.status)
  Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
    Column(modifier = Modifier.padding(14.dp)) {
      Text(step.title, style = MaterialTheme.typography.titleSmall)
      Text(summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}
