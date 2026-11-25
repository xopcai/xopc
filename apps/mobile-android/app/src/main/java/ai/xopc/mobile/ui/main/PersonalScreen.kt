package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.PersonalSummary
import ai.xopc.mobile.gateway.PersonalGoal
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerDefaults
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.runtime.remember
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PersonalGoalsScreen(state: PersonalUiState, insets: PaddingValues, onRefresh: () -> Unit,
  onSaveGoal: (String?, String, String, String, Long?) -> Unit, onBack: () -> Unit = {}) {
  val pager = key(state.gatewayId) { rememberPagerState { 2 } }
  val scope = rememberCoroutineScope()
  var editorOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var editingId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var title by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var outcome by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var date by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var status by rememberSaveable(state.gatewayId) { mutableStateOf("active") }
  var datePickerOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var saveStartedRevision by rememberSaveable(state.gatewayId) { mutableStateOf(state.savedGoalRevision) }
  fun openEditor(goal: PersonalGoal?) {
    editingId = goal?.id
    title = goal?.title.orEmpty()
    outcome = goal?.outcome.orEmpty()
    date = goal?.targetAt?.let(::goalDateText).orEmpty()
    status = goal?.status ?: "active"
    datePickerOpen = false
    saveStartedRevision = state.savedGoalRevision
    editorOpen = true
  }
  LaunchedEffect(state.savedGoalRevision, saveStartedRevision, editorOpen) {
    if (editorOpen && state.savedGoalRevision > saveStartedRevision) editorOpen = false
  }
  val goalTabs = listOf(
    SegmentOption(false, stringResource(R.string.personal_active), "personal-goals-ongoing"),
    SegmentOption(true, stringResource(R.string.personal_achieved), "personal-goals-achieved"),
  )
  fun selectGoalTab(value: Boolean) { scope.launch { pager.animateScrollToPage(if (value) 1 else 0) } }
  Column(Modifier.fillMaxSize().padding(insets).testTag("personal-goals-screen")) {
    XopcPageHeader("personal-goals-back", onBack, title = stringResource(R.string.personal_goals)) {
      IconButton(onClick = { openEditor(null) }, enabled = state.summary != null,
        modifier = Modifier.testTag("goal-add")) {
        ActionIcon(R.drawable.action_add, contentDescription = stringResource(R.string.personal_goal_add))
      }
    }
    SegmentedTabs(goalTabs, pager.settledPage == 1, ::selectGoalTab,
      modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp), enabled = !editorOpen,
      swipeToSelect = true, pager = pager)
    HorizontalPager(pager, modifier = Modifier.weight(1f).fillMaxWidth().testTag("personal-goals-pager"),
      userScrollEnabled = !editorOpen,
      flingBehavior = PagerDefaults.flingBehavior(pager, snapPositionalThreshold = 0.33f),
    ) { index ->
      Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(horizontal = 20.dp, vertical = 8.dp).testTag("personal-goals-list"),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (state.loading && state.summary == null) XopcListSkeleton(rows = 3)
        state.summary?.let { PersonalGoals(it, index == 1, ::openEditor) }
        if (state.error) {
          XopcErrorState(
            message = stringResource(R.string.personal_unavailable),
            retryLabel = stringResource(R.string.personal_retry),
            onRetry = onRefresh,
          )
        }
      }
    }
  }
  if (editorOpen) {
    val currentSaving by rememberUpdatedState(state.savingGoal)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true,
      confirmValueChange = { it != SheetValue.Hidden || !currentSaving })
    val keyboard = LocalSoftwareKeyboardController.current
    val outcomeFocus = remember { FocusRequester() }
    val fieldColors = TextFieldDefaults.colors(
      focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
      unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
      disabledContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
      focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
      disabledIndicatorColor = Color.Transparent)
    XopcBottomSheet(XopcSheetPreset.Large,
      onDismissRequest = { if (!state.savingGoal) editorOpen = false },
      sheetState = sheetState, containerColor = MaterialTheme.colorScheme.surface,
      modifier = Modifier.testTag("personal-goal-sheet")) {
      Column(Modifier.fillMaxWidth()
        .height(minOf(600.dp, LocalConfiguration.current.screenHeightDp.dp * 0.86f)).imePadding()
        .padding(bottom = 16.dp)) {
        XopcSheetHeader(
          title = stringResource(if (editingId == null) R.string.personal_goal_add else R.string.personal_goal_edit),
          subtitle = stringResource(R.string.personal_goal_help),
          onClose = { if (!state.savingGoal) editorOpen = false },
          closeEnabled = !state.savingGoal,
        )
        Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 24.dp),
          verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).testTag("goal-form"),
          verticalArrangement = Arrangement.spacedBy(20.dp)) {
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.personal_goal_title), style = MaterialTheme.typography.labelLarge)
            TextField(title, { title = it.take(120) },
              Modifier.fillMaxWidth().testTag("goal-title"), enabled = !state.savingGoal,
              placeholder = { Text(stringResource(R.string.personal_goal_title_hint)) },
              singleLine = true, shape = themedCorners(16), colors = fieldColors,
              keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
              keyboardActions = KeyboardActions(onNext = { outcomeFocus.requestFocus() }))
          }
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.personal_goal_outcome), style = MaterialTheme.typography.labelLarge)
            TextField(outcome, { outcome = it.take(600) },
              Modifier.fillMaxWidth().focusRequester(outcomeFocus).testTag("goal-outcome"),
              enabled = !state.savingGoal, minLines = 3, maxLines = 5,
              placeholder = { Text(stringResource(R.string.personal_goal_outcome_hint)) },
              shape = themedCorners(16), colors = fieldColors)
          }
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.personal_goal_date_optional), style = MaterialTheme.typography.labelLarge)
            Card(onClick = { keyboard?.hide(); datePickerOpen = true }, enabled = !state.savingGoal,
              modifier = Modifier.fillMaxWidth().testTag("goal-date"),
              shape = themedCorners(16), colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
              Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(date.ifBlank { stringResource(R.string.personal_goal_date_none) },
                  modifier = Modifier.weight(1f), color = if (date.isBlank())
                    MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                ActionIcon(R.drawable.action_chevron_right, size = 18.dp)
              }
            }
            if (date.isNotBlank()) TextButton(onClick = { date = "" }, enabled = !state.savingGoal,
              modifier = Modifier.testTag("goal-date-clear")) {
              Text(stringResource(R.string.personal_goal_date_clear))
            }
          }
          if (editingId != null) SegmentedTabs(
            listOf("active" to R.string.personal_active, "paused" to R.string.personal_paused,
              "achieved" to R.string.personal_achieved).map { (value, label) ->
              SegmentOption(value, stringResource(label), "goal-status-$value")
            }, status, { status = it }, enabled = !state.savingGoal,
          )
          if (state.goalError) Text(stringResource(R.string.personal_goal_save_error),
            color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("goal-save-error"))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          TextButton(onClick = { editorOpen = false }, enabled = !state.savingGoal,
            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("goal-cancel")) {
            Text(stringResource(R.string.progress_cancel))
          }
          Button(onClick = {
            keyboard?.hide()
            onSaveGoal(editingId, title.trim(), outcome.trim(), status, goalDateTimestamp(date))
          }, enabled = title.isNotBlank() && outcome.isNotBlank() && !state.savingGoal,
            modifier = Modifier.weight(2f).heightIn(min = 48.dp).testTag("goal-save")) {
            Text(stringResource(if (state.savingGoal) R.string.personal_agent_saving else R.string.progress_save))
          }
        }
        }
      }
    }
    if (datePickerOpen) {
      val picker = rememberDatePickerState(initialSelectedDateMillis = date.takeIf { it.isNotBlank() }
        ?.let { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() })
      DatePickerDialog(onDismissRequest = { datePickerOpen = false },
        modifier = Modifier.testTag("goal-date-picker"),
        confirmButton = { TextButton(onClick = {
          picker.selectedDateMillis?.let {
            date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()
          }
          datePickerOpen = false
        }, enabled = picker.selectedDateMillis != null, modifier = Modifier.testTag("goal-date-confirm")) {
          Text(stringResource(R.string.progress_save))
        } },
        dismissButton = { TextButton(onClick = { datePickerOpen = false }) {
          Text(stringResource(R.string.progress_cancel))
        } }) { DatePicker(state = picker) }
    }
  }
}

internal fun goalDateTimestamp(value: String): Long? {
  if (value.isBlank()) return null
  if (!value.trim().matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) return null
  return try {
    val date = LocalDate.parse(value.trim(), DateTimeFormatter.ISO_LOCAL_DATE)
    date.atTime(23, 59, 59).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
  } catch (_: DateTimeParseException) { null }
}

private fun goalDateText(timestamp: Long): String = Instant.ofEpochMilli(timestamp)
  .atZone(ZoneId.systemDefault()).toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE)

@Composable
internal fun PersonalAgentSettings(state: PersonalUiState, onOpenAgent: () -> Unit,
  onLoadAgentVoices: () -> Unit, onUpdateAgentProfile: (String, String, String?, Boolean, String) -> Unit,
  onUploadAvatar: suspend (ByteArray) -> Unit, onLoadModel: LoadPersonalModel?, onSaveModel: SavePersonalModel?) {
  var agentEditorOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  val ready = state.agent?.state == "ready"
  Card(onClick = { if (ready) agentEditorOpen = true else onOpenAgent() },
    enabled = !state.agentCreating && !state.agentLoading,
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    shape = themedCorners(16),
    modifier = Modifier.fillMaxWidth().testTag(if (ready) "personal-agent-configure" else "personal-agent-open")) {
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 14.dp),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      PersonalAgentAvatar(state.agentAvatar, state.agent?.appearance ?: "loopi", 40.dp, active = false)
      Column(Modifier.weight(1f)) {
        Text(state.agent?.displayName ?: stringResource(R.string.personal_agent_title),
          style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(stringResource(when {
          state.agentError -> R.string.personal_agent_error
          ready -> R.string.personal_agent_configure
          else -> R.string.personal_agent_create
        }), style = MaterialTheme.typography.bodySmall, color = if (state.agentError)
          MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
      }
      ActionIcon(R.drawable.action_chevron_right, size = 16.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
  if (agentEditorOpen) PersonalAgentProfileSheet(state, { agentEditorOpen = false }, onLoadAgentVoices,
    onUpdateAgentProfile, onUploadAvatar, onLoadModel, onSaveModel)
}

@Composable
private fun PersonalGoals(summary: PersonalSummary, completed: Boolean, onOpenGoal: (PersonalGoal?) -> Unit) {
  val goals = summary.goals.filter { (it.status == "achieved") == completed }
  if (goals.isNotEmpty()) goals.forEach { goal ->
    PersonalCard(onClick = { onOpenGoal(goal) }, tag = "goal-${goal.id}") {
      Text(goal.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
      Text(goal.outcome, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2,
        overflow = TextOverflow.Ellipsis)
      Text(stringResource(if (goal.isPrimary && !completed) R.string.personal_primary else when (goal.status) {
        "achieved" -> R.string.personal_achieved
        "paused" -> R.string.personal_paused
        "proposed" -> R.string.personal_proposed
        else -> R.string.personal_active
      }), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
      goal.targetAt?.let { Text(stringResource(R.string.personal_goal_due, goalDateText(it)),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
  } else if (!completed && summary.goals.isEmpty()) PersonalCard(onClick = { onOpenGoal(null) }) {
    Text(summary.focusTitle.ifBlank { stringResource(R.string.personal_goal_empty) },
      style = MaterialTheme.typography.titleMedium)
    if (summary.focusOutcome.isNotBlank()) Text(summary.focusOutcome,
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  } else Text(stringResource(R.string.personal_goal_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun PersonalCard(onClick: (() -> Unit)? = null, tag: String? = null,
  content: @Composable () -> Unit) {
  val shape = themedCorners(16)
  val modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
    .then(if (tag != null) Modifier.testTag(tag) else Modifier)
    .then(if (onClick != null) Modifier.clip(shape).clickable(onClick = onClick) else Modifier)
  Card(modifier, shape = shape,
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { content() }
  }
}
