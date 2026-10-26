package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.AndroidSecureStore
import ai.xopc.mobile.gateway.ClarificationAnswer
import ai.xopc.mobile.gateway.ClarificationCommand
import ai.xopc.mobile.gateway.ClarificationRequest
import ai.xopc.mobile.gateway.clarificationRecordKey
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
internal fun ClarificationWizard(request: ClarificationRequest, submitting: Boolean, error: String?,
  onCommand: (ClarificationCommand) -> Unit, modifier: Modifier = Modifier) {
  val context = LocalContext.current.applicationContext
  val store = remember(context) { AndroidSecureStore(context) }
  val key = clarificationRecordKey(request.scope, "clarify-draft.${request.id}.${request.version}")
  var record by remember(key) { mutableStateOf("{}") }
  var preparing by remember(key) { mutableStateOf(false) }
  var ready by remember(key) { mutableStateOf(false) }
  var storageError by remember(key) { mutableStateOf<String?>(null) }
  var now by remember(key) { mutableLongStateOf(System.currentTimeMillis()) }
  val scope = rememberCoroutineScope()
  LaunchedEffect(key) {
    try { record = withContext(Dispatchers.IO) { store.read(key) } ?: "{}"; ready = true }
    catch (failure: Exception) { storageError = failure.message }
  }
  LaunchedEffect(key, record, ready) {
    if (ready) { delay(200); try { withContext(Dispatchers.IO) { store.write(key, record) } }
      catch (failure: Exception) { storageError = failure.message } }
  }
  LaunchedEffect(key, request.expiresAt) {
    if (request.expiresAt != null) while (true) { now = System.currentTimeMillis(); delay(1000) }
  }
  val data = JSONObject(record)
  val index = data.optInt("index").coerceIn(0, request.questions.lastIndex)
  val question = request.questions[index]
  val values = data.optJSONObject("values") ?: JSONObject()
  val value = values.optJSONObject(question.id) ?: JSONObject()
  val choiceId = value.optString("choiceId").takeIf(String::isNotEmpty)
  val text = value.optString("text")
  val pending = data.optString("pending").takeIf(String::isNotEmpty)
  val disabled = !ready || submitting || preparing || request.expired(now)
  val locked = disabled || pending != null
  val answers = request.questions.map { q ->
    val entry = values.optJSONObject(q.id)
    ClarificationAnswer(q.id, entry?.optString("choiceId")?.takeIf(String::isNotEmpty), entry?.optString("text")?.trim()?.takeIf(String::isNotEmpty))
  }
  val complete = request.accepts(answers)
  fun update(selected: String?, draft: String) {
    values.put(question.id, JSONObject().put("choiceId", selected ?: "").put("text", draft))
    data.put("values", values); record = data.toString()
  }
  fun submit(action: String) {
    if (disabled) return
    preparing = true
    scope.launch {
      try {
        val frozen = JSONObject(record).put("pending", action).toString()
        withContext(Dispatchers.IO) { store.write(key, frozen) }; record = frozen
        onCommand(ClarificationCommand(action = action, schemaVersion = 2, answers = if (action == "answer") answers else null))
      } catch (failure: Exception) { storageError = failure.message }
      finally { preparing = false }
    }
  }
  Surface(modifier, shape = MaterialTheme.shapes.large, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
    Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(stringResource(R.string.clarify_title), style = MaterialTheme.typography.titleSmall)
      Text("${index + 1}/${request.questions.size} · ${question.header}")
      Text(question.question)
      question.choices.forEach { choice ->
        OutlinedButton(modifier = Modifier.fillMaxWidth(), enabled = !locked, onClick = { update(choice.id, text) }) {
          Column(Modifier.fillMaxWidth()) {
            Text((if (choiceId == choice.id) "✓ " else "") + choice.label + if (choice.id == question.recommendedChoiceId) " · " + stringResource(R.string.clarify_recommended) else "")
            choice.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
          }
        }
      }
      if (choiceId != null) TextButton(enabled = !locked, onClick = { update(null, text) }) { Text(stringResource(R.string.clarify_clear)) }
      OutlinedTextField(text, { update(choiceId, it) }, enabled = !locked, minLines = 2, maxLines = 5,
        modifier = Modifier.fillMaxWidth(), isError = text.trim().length > 2000,
        label = { Text(stringResource(if (choiceId == null) R.string.clarify_custom else R.string.clarify_supplement)) },
        supportingText = { Text("${text.trim().length}/2000") })
      if (!complete && answers.all { it.choiceId != null || !it.text.isNullOrBlank() })
        Text(stringResource(R.string.clarify_too_long), color = MaterialTheme.colorScheme.error)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(enabled = !disabled && index > 0, onClick = { data.put("index", index - 1); record = data.toString() }) { Text(stringResource(R.string.clarify_previous)) }
        if (index < request.questions.lastIndex) TextButton(enabled = !disabled, onClick = { data.put("index", index + 1); record = data.toString() }) { Text(stringResource(R.string.clarify_next)) }
        Button(enabled = !disabled && (pending != null || complete), onClick = { submit(pending ?: "answer") }) {
          Text(stringResource(if (pending == null) R.string.voice_answer_send else R.string.clarify_retry))
        }
      }
      if (pending == null) FlowRow {
        TextButton(enabled = !disabled, onClick = { submit("agent_decide") }) { Text(stringResource(R.string.voice_agent_decide)) }
        TextButton(enabled = !disabled, onClick = { submit("cancel") }) { Text(stringResource(R.string.clarify_cancel)) }
      }
      if (request.expired(now)) Text(stringResource(R.string.clarify_expired))
      if (submitting) CircularProgressIndicator(Modifier.size(20.dp))
      (error ?: storageError)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
  }
}
