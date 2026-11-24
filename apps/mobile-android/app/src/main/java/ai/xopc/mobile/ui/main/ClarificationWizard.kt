package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.AndroidSecureStore
import ai.xopc.mobile.gateway.ClarificationAnswer
import ai.xopc.mobile.gateway.ClarificationCommand
import ai.xopc.mobile.gateway.ClarificationRequest
import ai.xopc.mobile.gateway.clarificationRecordKey
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
internal fun ClarificationWizard(
  request: ClarificationRequest,
  submitting: Boolean,
  error: String?,
  onCommand: (ClarificationCommand) -> Unit,
  modifier: Modifier = Modifier,
) {
  val palette = rememberClarificationPalette()
  val haptic = LocalHapticFeedback.current
  val context = LocalContext.current.applicationContext
  val store = remember(context) { AndroidSecureStore(context) }
  val key = clarificationRecordKey(request.scope, "clarify-draft.${request.id}.${request.version}")
  var record by remember(key) { mutableStateOf("{}") }
  var preparing by remember(key) { mutableStateOf(false) }
  var ready by remember(key) { mutableStateOf(false) }
  var storageError by remember(key) { mutableStateOf<String?>(null) }
  var collapsed by rememberSaveable(key) { mutableStateOf(false) }
  var expandedCustomId by rememberSaveable(key) { mutableStateOf<String?>(null) }
  var now by remember(key) { mutableLongStateOf(System.currentTimeMillis()) }
  val scope = rememberCoroutineScope()

  LaunchedEffect(key) {
    try { record = withContext(Dispatchers.IO) { store.read(key) } ?: "{}"; ready = true }
    catch (failure: Exception) { storageError = failure.message }
  }
  LaunchedEffect(key, record, ready) {
    if (ready) {
      delay(200)
      try { withContext(Dispatchers.IO) { store.write(key, record) } }
      catch (failure: Exception) { storageError = failure.message }
    }
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
    ClarificationAnswer(
      q.id,
      entry?.optString("choiceId")?.takeIf(String::isNotEmpty),
      entry?.optString("text")?.trim()?.takeIf(String::isNotEmpty),
    )
  }
  val answeredCount = answers.count { it.choiceId != null || !it.text.isNullOrBlank() }
  val complete = request.accepts(answers)
  val isMulti = request.questions.size > 1

  fun update(selected: String?, draft: String, nextIndex: Int = index) {
    val nextValues = JSONObject(values.toString())
    nextValues.put(question.id, JSONObject().put("choiceId", selected ?: "").put("text", draft))
    val nextData = JSONObject(data.toString()).put("values", nextValues).put("index", nextIndex)
    record = nextData.toString()
  }

  fun moveTo(nextIndex: Int) {
    expandedCustomId = null
    val nextData = JSONObject(data.toString()).put("index", nextIndex)
    record = nextData.toString()
  }

  fun submit(action: String, overrideAnswers: List<ClarificationAnswer> = answers) {
    if (disabled) return
    preparing = true
    scope.launch {
      try {
        val frozen = JSONObject(record).put("pending", action).toString()
        withContext(Dispatchers.IO) { store.write(key, frozen) }
        record = frozen
        onCommand(ClarificationCommand(action = action, schemaVersion = 2, answers = if (action == "answer") overrideAnswers else null))
      } catch (failure: Exception) { storageError = failure.message }
      finally { preparing = false }
    }
  }

  fun pickChoice(pickedId: String) {
    if (locked) return
    val nextAnswers = answers.map {
      if (it.questionId == question.id) it.copy(choiceId = pickedId, text = text.trim().takeIf(String::isNotEmpty)) else it
    }
    if (!isMulti && text.isBlank() && expandedCustomId != question.id) {
      update(pickedId, text)
      submit("answer", nextAnswers)
      return
    }
    val nextUnanswered = request.questions.indexOfFirst { q ->
      val a = nextAnswers.find { it.questionId == q.id }
      a?.choiceId == null && a?.text.isNullOrBlank()
    }
    if (nextUnanswered != -1) {
      expandedCustomId = null
      update(pickedId, text, nextIndex = nextUnanswered)
    } else {
      update(pickedId, text)
    }
  }

  if (collapsed) {
    ClarificationCollapsedBar(
      title = question.header.ifBlank { stringResource(R.string.clarify_title) },
      progress = if (isMulti) "$answeredCount/${request.questions.size}" else null,
      palette = palette,
      onExpand = { collapsed = false },
      modifier = modifier,
    )
    return
  }

  val showCustom = question.type != "single_choice" || expandedCustomId == question.id || text.isNotEmpty()
  val summaryLine = if (isMulti && answeredCount == request.questions.size) {
    request.questions.mapNotNull { q ->
      val a = answers.find { it.questionId == q.id } ?: return@mapNotNull null
      val label = q.choices.find { it.id == a.choiceId }?.label
      listOfNotNull(label, a.text).filter(String::isNotBlank).joinToString(" · ").takeIf(String::isNotBlank)
    }.joinToString(" · ").takeIf(String::isNotBlank)
  } else null

  ClarificationCardSurface(palette, modifier) {
    Column(Modifier.fillMaxWidth()) {
      Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          if (isMulti) {
            Row(
              Modifier.weight(1f).horizontalScroll(rememberScrollState()),
              horizontalArrangement = Arrangement.spacedBy(6.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              request.questions.forEachIndexed { idx, q ->
                val active = idx == index
                val done = answers[idx].let { it.choiceId != null || !it.text.isNullOrBlank() }
                Surface(
                  shape = CircleShape,
                  color = when {
                    active -> palette.accentSoft
                    done -> palette.grouped
                    else -> Color.Transparent
                  },
                  modifier = Modifier.clip(CircleShape).clickable(enabled = !locked) { moveTo(idx) },
                ) {
                  Text(
                    "${idx + 1}. ${q.header}" + if (done) " ✓" else "",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = when {
                      active -> palette.accentText
                      done -> palette.primaryText
                      else -> palette.secondaryText
                    },
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                  )
                }
              }
            }
            Text("$answeredCount/${request.questions.size}", style = MaterialTheme.typography.labelSmall, color = palette.tertiaryText)
          } else {
            Text(question.header, style = MaterialTheme.typography.labelMedium, color = palette.secondaryText, modifier = Modifier.weight(1f))
          }
          ClarificationHeaderActions(
            showMenu = pending == null,
            disabled = locked,
            palette = palette,
            onAgentDecide = { submit("agent_decide") },
            onCancel = { submit("cancel") },
            onCollapse = { collapsed = true },
          )
        }
        if (isMulti) {
          Row(Modifier.fillMaxWidth().padding(end = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            request.questions.forEachIndexed { idx, _ ->
              val done = answers[idx].let { it.choiceId != null || !it.text.isNullOrBlank() }
              Box(
                Modifier.weight(1f).height(2.5.dp).clip(CircleShape).background(
                  when {
                    done -> palette.accent
                    idx == index -> palette.accent.copy(alpha = 0.45f)
                    else -> palette.grouped
                  },
                ),
              )
            }
          }
        }
      }

      Column(
        Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        Text(question.question, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = palette.primaryText)

        if (question.type == "single_choice") {
          ClarificationOptionsGroup(
            choices = question.choices,
            recommendedId = question.recommendedChoiceId,
            selectedId = choiceId,
            customExpanded = showCustom,
            disabled = locked,
            palette = palette,
            onPick = ::pickChoice,
            onToggleCustom = { expandedCustomId = if (showCustom) null else question.id },
          )
        }

        if (showCustom) {
          ClarificationCustomEditor(
            selectedLabel = question.choices.find { it.id == choiceId }?.label,
            text = text,
            onTextChange = { update(choiceId, it) },
            limit = 2000,
            disabled = locked,
            palette = palette,
            onClearSelection = { update(null, text) },
          )
        }

        summaryLine?.let { summary ->
          Surface(shape = RoundedCornerShape(10.dp), color = palette.grouped.copy(alpha = 0.85f), modifier = Modifier.fillMaxWidth()) {
            Text(
              "✓  $summary",
              style = MaterialTheme.typography.bodySmall,
              color = palette.secondaryText,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            )
          }
        }

        if (!complete && answeredCount == request.questions.size) {
          Text(stringResource(R.string.clarify_too_long), color = palette.danger, style = MaterialTheme.typography.bodySmall)
        }
        if (request.expired(now)) Text(stringResource(R.string.clarify_expired), color = palette.danger, style = MaterialTheme.typography.bodySmall)
        (error ?: storageError)?.let { Text(it, color = palette.danger, style = MaterialTheme.typography.bodySmall) }
      }

      val needsFooter = isMulti || showCustom || pending != null || submitting || complete
      if (needsFooter) {
        HorizontalDivider(thickness = 0.5.dp, color = palette.divider)
        Row(
          Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
          if (isMulti && index > 0) {
            Button(
              onClick = { moveTo(index - 1) },
              enabled = !disabled,
              shape = CircleShape,
              colors = ButtonDefaults.buttonColors(containerColor = palette.tonalFill, contentColor = palette.tonalText),
              elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp),
              contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            ) { Text(stringResource(R.string.clarify_previous), fontWeight = FontWeight.Medium) }
          }
          Spacer(Modifier.weight(1f))
          val currentValid = choiceId != null || text.isNotBlank()
          if (isMulti && !complete && index < request.questions.lastIndex && pending == null) {
            Button(
              onClick = { moveTo(index + 1) },
              enabled = !disabled && currentValid,
              shape = CircleShape,
              colors = ButtonDefaults.buttonColors(containerColor = palette.accent, contentColor = palette.onAccent),
              elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp),
              contentPadding = PaddingValues(horizontal = 18.dp, vertical = 8.dp),
            ) { Text(stringResource(R.string.clarify_next), fontWeight = FontWeight.SemiBold) }
          } else {
            Button(
              onClick = { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); submit(pending ?: "answer") },
              enabled = !disabled && (pending != null || complete),
              shape = CircleShape,
              colors = ButtonDefaults.buttonColors(containerColor = palette.accent, contentColor = palette.onAccent),
              elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp),
              contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            ) {
              if (submitting) CircularProgressIndicator(Modifier.size(16.dp), color = palette.onAccent, strokeWidth = 2.dp)
              else Text(stringResource(if (pending == null) R.string.clarify_confirm else R.string.clarify_retry), fontWeight = FontWeight.SemiBold)
            }
          }
        }
      }
    }
  }
}
