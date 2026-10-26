package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ClarificationCommand
import ai.xopc.mobile.gateway.ClarificationRequest
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable
internal fun ClarificationCard(request: ClarificationRequest, submitting: Boolean, error: String?,
  onCommand: (ClarificationCommand) -> Unit, modifier: Modifier = Modifier) {
  if (request.schemaVersion == 2) {
    ClarificationWizard(request, submitting, error, onCommand, modifier)
    return
  }
  var draft by rememberSaveable(request.id) { mutableStateOf("") }
  var selected by rememberSaveable(request.id) { mutableStateOf<String?>(null) }
  var editing by rememberSaveable(request.id) { mutableStateOf(false) }
  var now by remember(request.id) { mutableLongStateOf(System.currentTimeMillis()) }
  LaunchedEffect(request.id, request.expiresAt) {
    if (request.expiresAt != null) while (true) { now = System.currentTimeMillis(); delay(1000) }
  }
  val disabled = submitting || request.expired(now)
  val compose = request.interactionMode == "compose" || editing
  val text = draft.trim()
  Surface(modifier, shape = MaterialTheme.shapes.large, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
    Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(stringResource(if (request.kind == "approval") R.string.clarify_approval_title else R.string.clarify_title), style = MaterialTheme.typography.titleSmall)
      Text(request.question)
      request.expiresAt?.let {
        val seconds = ((it - now - request.clockOffset).coerceAtLeast(0) + 999) / 1000
        Text(if (seconds == 0L) stringResource(R.string.clarify_expired) else stringResource(R.string.clarify_remaining, seconds / 60, seconds % 60), style = MaterialTheme.typography.labelSmall)
      }
      if (request.kind == "approval") {
        request.approval?.let { approval ->
          Text(approval.getString("operation"), style = MaterialTheme.typography.titleSmall)
          listOf("target", "impact").forEach { key -> approval.optString(key).takeIf(String::isNotBlank)?.let { Text(it) } }
          var details by rememberSaveable(request.id) { mutableStateOf(false) }
          if (approval.has("argumentsPreview")) {
            TextButton(onClick = { details = !details }) { Text(stringResource(R.string.clarify_details)) }
            if (details) Text(approval.getJSONObject("argumentsPreview").toString(2), style = MaterialTheme.typography.bodySmall)
          }
        }
        Text(stringResource(R.string.clarify_once), style = MaterialTheme.typography.bodySmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(enabled = !disabled, onClick = { onCommand(ClarificationCommand(decision = "deny")) }) { Text(stringResource(R.string.clarify_deny)) }
          Button(enabled = !disabled, onClick = { onCommand(ClarificationCommand(decision = "approve")) }) { Text(stringResource(R.string.clarify_approve)) }
        }
      } else {
        if (request.choiceDetails.isNotEmpty() && !compose) {
          Text(stringResource(R.string.clarify_quick_hint), style = MaterialTheme.typography.bodySmall)
          TextButton(enabled = !disabled, onClick = { editing = true }) { Text(stringResource(R.string.clarify_compose)) }
        }
        request.choiceDetails.forEach { choice ->
          OutlinedButton(modifier = Modifier.fillMaxWidth(), enabled = !disabled, onClick = {
            if (compose || draft.isNotEmpty()) { editing = true; selected = choice.id }
            else onCommand(ClarificationCommand(choiceId = choice.id))
          }) {
            Column(Modifier.fillMaxWidth()) {
              Text((if (selected == choice.id) "✓ " else "") + choice.label + if (choice.id == request.recommendedChoiceId) " · " + stringResource(R.string.clarify_recommended) else "")
              choice.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
          }
        }
        if (selected != null) TextButton(enabled = !disabled, onClick = { selected = null }) { Text(stringResource(R.string.clarify_clear)) }
        OutlinedTextField(draft, { draft = it; if (it.isNotEmpty()) editing = true }, minLines = 2, maxLines = 6,
          enabled = !disabled, isError = text.length > 8000, modifier = Modifier.fillMaxWidth(),
          label = { Text(stringResource(if (selected == null) R.string.clarify_custom else R.string.clarify_supplement)) },
          supportingText = { Text("${text.length}/8000") })
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          TextButton(enabled = !disabled, onClick = { onCommand(ClarificationCommand(action = "agent_decide")) }) { Text(stringResource(R.string.voice_agent_decide)) }
          TextButton(enabled = !submitting, onClick = { onCommand(ClarificationCommand(action = "cancel")) }) { Text(stringResource(R.string.clarify_cancel)) }
          Button(enabled = !disabled && text.length <= 8000 && (selected != null || text.isNotEmpty()), onClick = {
            onCommand(ClarificationCommand(choiceId = selected, text = text.ifEmpty { null }))
          }) { Text(stringResource(R.string.voice_answer_send)) }
        }
      }
      if (submitting) CircularProgressIndicator(Modifier.size(20.dp))
      error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
  }
}
