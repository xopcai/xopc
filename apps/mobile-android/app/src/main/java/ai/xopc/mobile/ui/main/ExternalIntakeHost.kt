package ai.xopc.mobile.ui.main

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationSummary
import ai.xopc.mobile.gateway.ExternalFileBatch
import ai.xopc.mobile.gateway.ExternalFileIntake
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun ExternalIntakeHost(connection: ConnectionUiState,
  searchConversations: suspend (String) -> List<ConversationSummary>,
  append: suspend (ExternalFileBatch, String?) -> Unit, onAdded: () -> Unit) {
  val context = LocalContext.current
  val intake = remember(context) { ExternalFileIntake.get(context) }
  val batches by intake.batches.collectAsStateWithLifecycle()
  val batch = batches.firstOrNull() ?: return
  val profile = connection.profile ?: return
  key(batch.id, profile.gatewayId, profile.deviceId) {
    val scope = rememberCoroutineScope()
    var selected by remember { mutableStateOf(batch.targetConversation ?: "") }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf(emptyList<ConversationSummary>()) }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(query) {
      loading = true
      try { results = searchConversations(query) }
      catch (error: Exception) { failure = error.message }
      finally { loading = false }
    }
    val wrongConnection = batch.targetGateway != null &&
      (batch.targetGateway != profile.gatewayId || batch.targetDevice != profile.deviceId)
    ExternalIntakeDialog(batch, selected, query, results, connection.selectedConversationId,
      busy, loading, if (wrongConnection) stringResource(R.string.intake_wrong_connection) else failure,
      canAdd = !wrongConnection && batch.files.isNotEmpty(),
      onSelect = { selected = it }, onQuery = { query = it },
      onCancel = {
        if (!busy) scope.launch {
          busy = true
          try { withContext(Dispatchers.IO) { intake.dismiss(batch.id) } }
          catch (error: Exception) { failure = error.message; busy = false }
        }
      },
      onAdd = {
        if (!busy) scope.launch {
          busy = true; failure = null
          try { append(batch, selected.ifBlank { null }); onAdded() }
          catch (error: Exception) { failure = error.message }
          finally { busy = false }
        }
      })
  }
}

@Composable
private fun ExternalIntakeDialog(batch: ExternalFileBatch, selected: String, query: String,
  results: List<ConversationSummary>, currentId: String?, busy: Boolean, loading: Boolean,
  error: String?, canAdd: Boolean, onSelect: (String) -> Unit, onQuery: (String) -> Unit,
  onCancel: () -> Unit, onAdd: () -> Unit) {
  Dialog(onDismissRequest = { if (!busy) onCancel() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Surface(shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth(.95f).fillMaxHeight(.9f)) {
      Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.intake_title), style = MaterialTheme.typography.titleLarge)
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          items(batch.files, key = { it.id }) { file ->
            Text("${file.name} · ${file.size / 1024} KB", modifier = Modifier.fillMaxWidth().padding(12.dp))
          }
          items(batch.errors) { Text(it, color = MaterialTheme.colorScheme.error) }
          if (batch.targetConversation == null) {
            item { IntakeTarget("", stringResource(R.string.intake_new), selected, !busy, onSelect) }
            if (currentId != null) item {
              IntakeTarget(currentId, stringResource(R.string.intake_current) + " · " +
                (results.firstOrNull { it.id == currentId }?.title ?: currentId), selected, !busy, onSelect)
            }
            item { OutlinedTextField(query, onQuery, modifier = Modifier.fillMaxWidth(),
              singleLine = true, enabled = !busy, label = { Text(stringResource(R.string.intake_search)) }) }
            if (loading) item { Box(Modifier.fillMaxWidth().height(48.dp).background(MaterialTheme.colorScheme.surfaceContainerHighest)) }
            else items(results.filter { it.id != currentId }, key = { it.id }) { conversation ->
              IntakeTarget(conversation.id, "${conversation.title.ifBlank { conversation.id }} · ${conversation.agentId.orEmpty()}", selected, !busy, onSelect)
            }
          } else item { Text(stringResource(R.string.intake_selected) + " · " + batch.targetConversation) }
          if (error != null) item { Text(error, color = MaterialTheme.colorScheme.error) }
        }
        Text(stringResource(R.string.intake_hint), style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
          TextButton(onClick = onCancel, enabled = !busy) { Text(stringResource(R.string.intake_cancel)) }
          Button(onClick = onAdd, enabled = !busy && canAdd) { Text(stringResource(if (busy) R.string.intake_adding else R.string.intake_add)) }
        }
      }
    }
  }
}

@Composable
private fun IntakeTarget(id: String, label: String, selected: String, enabled: Boolean, onSelect: (String) -> Unit) {
  Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled) { onSelect(id) }) {
    RadioButton(selected == id, onClick = null, enabled = enabled)
    Text(label, modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
  }
}
