package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.PersonalSummary
import ai.xopc.mobile.gateway.PersonalGoal
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

@Composable
internal fun UnpairedPersonalScreen(insets: PaddingValues, onOpenSettings: () -> Unit,
  onConnect: () -> Unit) {
  val settingsLabel = stringResource(R.string.settings_title)
  Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState())
    .padding(horizontal = 20.dp).testTag("personal-unpaired")) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp),
      verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(R.string.tab_me), style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
      IconButton(onClick = onOpenSettings,
        modifier = Modifier.semantics { contentDescription = settingsLabel }
          .testTag("personal-settings")) {
        Icon(painterResource(R.drawable.settings_gear), contentDescription = null,
          tint = MaterialTheme.colorScheme.onSurface)
      }
    }
    ProfileCard(null, connected = false, onOpenAbout = onConnect)
    Text(stringResource(R.string.pairing_hint), style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.padding(top = 24.dp, bottom = 16.dp))
    Button(onClick = onConnect, modifier = Modifier.fillMaxWidth().testTag("personal-connect")) {
      Text(stringResource(R.string.pairing_connect))
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PersonalScreen(state: PersonalUiState, insets: PaddingValues, connected: Boolean,
  onRefresh: () -> Unit, onSaveGoal: (String?, String, String, String, Long?) -> Unit =
    { _, _, _, _, _ -> }, onOpenAbout: () -> Unit = {},
  onOpenUnderstanding: () -> Unit = {},
  onOpenSettings: () -> Unit = {},
  onOpenAssertion: (String) -> Unit = {},
  onOpenAgent: () -> Unit = {},
  onLoadAgentVoices: () -> Unit = {},
  onUpdateAgentProfile: (String, String, Map<String, String>, String?) -> Unit = { _, _, _, _ -> },
  onLoadProactivity: suspend () -> ai.xopc.mobile.gateway.PersonalProactivitySettings = { error("UNAVAILABLE") },
  onSaveProactivity: suspend (ai.xopc.mobile.gateway.PersonalProactivitySettings) -> ai.xopc.mobile.gateway.PersonalProactivitySettings = { error("UNAVAILABLE") },
  onUploadAvatar: suspend (ByteArray) -> Unit = {}, onModel: () -> Unit = {},
  bottomChromeHeight: Dp = 0.dp) {
  var agentEditorOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  fun openAgentEditor() { if (state.agent != null) agentEditorOpen = true }
  var editorOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var editingId by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var title by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var outcome by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var date by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var status by rememberSaveable(state.gatewayId) { mutableStateOf("active") }
  var dateError by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var saveStartedRevision by rememberSaveable(state.gatewayId) { mutableStateOf(state.savedGoalRevision) }
  fun openEditor(goal: PersonalGoal?) {
    editingId = goal?.id
    title = goal?.title.orEmpty()
    outcome = goal?.outcome.orEmpty()
    date = goal?.targetAt?.let(::goalDateText).orEmpty()
    status = goal?.status ?: "active"
    dateError = false
    saveStartedRevision = state.savedGoalRevision
    editorOpen = true
  }
  LaunchedEffect(state.savedGoalRevision, saveStartedRevision, editorOpen) {
    if (editorOpen && state.savedGoalRevision > saveStartedRevision) editorOpen = false
  }
  val settingsLabel = stringResource(R.string.settings_title)
  val loadingHeight = (LocalConfiguration.current.screenHeightDp.dp - bottomChromeHeight - 260.dp)
    .coerceAtLeast(220.dp)
  Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState())
    .padding(horizontal = 20.dp).testTag("personal-screen")) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp),
      verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(R.string.tab_me), style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
      IconButton(onClick = onOpenSettings,
        modifier = Modifier.semantics { contentDescription = settingsLabel }.testTag("personal-settings")) {
        Icon(painterResource(R.drawable.settings_gear), contentDescription = null,
          tint = MaterialTheme.colorScheme.onSurface)
      }
    }
    ProfileCard(state.summary, connected, onOpenAbout)
    Spacer(Modifier.height(16.dp))
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
      shape = RoundedCornerShape(22.dp),
      modifier = Modifier.fillMaxWidth().testTag("personal-agent-card")) {
      Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          PersonalAgentAvatar(state.agentAvatar, state.agent?.appearance ?: "loopi", 36.dp,
            active = false)
          Text(state.agent?.displayName ?: stringResource(R.string.personal_agent_title),
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        Text(stringResource(R.string.personal_agent_description),
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onOpenAgent, enabled = !state.agentCreating && !state.agentLoading,
          modifier = Modifier.fillMaxWidth().testTag("personal-agent-open")) {
          Text(stringResource(if (state.agent?.state == "ready") R.string.personal_agent_open
            else R.string.personal_agent_create))
        }
        if (state.agent?.state == "ready") TextButton(onClick = ::openAgentEditor,
          modifier = Modifier.fillMaxWidth().testTag("personal-agent-configure")) {
          Text(stringResource(R.string.personal_agent_configure))
        }
        if (state.agentCreating || state.agentLoading) BrandLoadingIndicator()
        if (state.agentError) {
          Text(stringResource(R.string.personal_agent_error), color = MaterialTheme.colorScheme.error)
          TextButton(onClick = onOpenAgent) { Text(stringResource(R.string.personal_retry)) }
        }
      }
    }
    if (state.loading && state.summary == null) {
      BrandLoadingPanel(modifier = Modifier.testTag("personal-loading"), minHeight = loadingHeight)
    } else {
      state.summary?.let { summary -> PersonalSections(summary, ::openEditor,
        onOpenUnderstanding, onOpenAssertion) }
    }
    if (state.error) {
      Text(stringResource(R.string.personal_unavailable), color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 16.dp))
      TextButton(onClick = onRefresh) { Text(stringResource(R.string.personal_retry)) }
    }
    Spacer(Modifier.height(bottomChromeHeight + 24.dp))
  }
  if (agentEditorOpen) PersonalAgentProfileSheet(state, { agentEditorOpen = false }, onLoadAgentVoices,
    onUpdateAgentProfile, onLoadProactivity, onSaveProactivity, onUploadAvatar, { agentEditorOpen = false; onModel() })
  if (editorOpen) ModalBottomSheet(onDismissRequest = { if (!state.savingGoal) editorOpen = false },
    modifier = Modifier.testTag("personal-goal-sheet")) {
    Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState())
      .padding(horizontal = 20.dp).padding(bottom = 24.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(stringResource(if (editingId == null) R.string.personal_goal_add else R.string.personal_goal_edit),
        style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
      Text(stringResource(R.string.personal_goal_help), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(title, { title = it.take(120) }, Modifier.fillMaxWidth().testTag("goal-title"),
        label = { Text(stringResource(R.string.personal_goal_title)) }, singleLine = true)
      OutlinedTextField(outcome, { outcome = it.take(600) }, Modifier.fillMaxWidth().height(140.dp)
        .testTag("goal-outcome"), label = { Text(stringResource(R.string.personal_goal_outcome)) })
      OutlinedTextField(date, { date = it; dateError = false }, Modifier.fillMaxWidth().testTag("goal-date"),
        label = { Text(stringResource(R.string.personal_goal_date)) }, singleLine = true,
        isError = dateError)
      if (dateError) Text(stringResource(R.string.personal_goal_date_error),
        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
      if (editingId != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("active" to R.string.personal_active, "paused" to R.string.personal_paused,
          "achieved" to R.string.personal_achieved).forEach { (value, label) ->
          FilterChip(selected = status == value, onClick = { status = value },
            label = { Text(stringResource(label)) })
        }
      }
      if (state.goalError) Text(stringResource(R.string.personal_goal_save_error),
        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = { editorOpen = false }, enabled = !state.savingGoal,
          modifier = Modifier.weight(1f)) { Text(stringResource(R.string.progress_cancel)) }
        Button(onClick = {
          val target = goalDateTimestamp(date)
          dateError = date.isNotBlank() && target == null
          if (!dateError) onSaveGoal(editingId, title, outcome, status, target)
        }, enabled = title.isNotBlank() && outcome.isNotBlank() && !state.savingGoal,
          modifier = Modifier.weight(1f).testTag("goal-save")) {
          Text(stringResource(R.string.progress_save))
        }
      }
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
private fun ProfileCard(summary: PersonalSummary?, connected: Boolean, onOpenAbout: () -> Unit) {
  Card(onClick = onOpenAbout, modifier = Modifier.fillMaxWidth().testTag("personal-profile"),
    shape = RoundedCornerShape(22.dp), colors = CardDefaults.cardColors(
      containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Row(Modifier.padding(20.dp), horizontalArrangement = Arrangement.spacedBy(16.dp),
      verticalAlignment = Alignment.CenterVertically) {
      val name = summary?.name.orEmpty().ifBlank { stringResource(R.string.personal_default_name) }
      Box(Modifier.size(64.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
        contentAlignment = Alignment.Center) {
        Text(name.take(2).uppercase(), color = MaterialTheme.colorScheme.primary,
          style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
      }
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
          maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(summary?.role.orEmpty().ifBlank { stringResource(R.string.personal_profile_hint) },
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(stringResource(if (connected) R.string.personal_connected else R.string.personal_offline),
          style = MaterialTheme.typography.labelSmall, color = if (connected)
            MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        summary?.let { Text(stringResource(R.string.personal_count, it.counts.total, it.counts.review),
          style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
    }
  }
}

@Composable
private fun PersonalSections(summary: PersonalSummary, onOpenGoal: (PersonalGoal?) -> Unit,
  onOpenUnderstanding: () -> Unit, onOpenAssertion: (String) -> Unit) {
  Row(Modifier.fillMaxWidth().padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(stringResource(R.string.personal_goals), style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
    TextButton(onClick = { onOpenGoal(null) }, modifier = Modifier.testTag("goal-add")) {
      Text(stringResource(R.string.personal_goal_add))
    }
  }
  if (summary.goals.isNotEmpty()) summary.goals.forEach { goal ->
    PersonalCard(onClick = { onOpenGoal(goal) }, tag = "goal-${goal.id}") {
      Text(goal.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
      Text(goal.outcome, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2,
        overflow = TextOverflow.Ellipsis)
      Text(stringResource(if (goal.isPrimary) R.string.personal_primary else when (goal.status) {
        "paused" -> R.string.personal_paused
        "proposed" -> R.string.personal_proposed
        else -> R.string.personal_active
      }), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
      goal.targetAt?.let { Text(stringResource(R.string.personal_goal_due, goalDateText(it)),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
  } else PersonalCard(onClick = { onOpenGoal(null) }) {
    Text(summary.focusTitle.ifBlank { stringResource(R.string.personal_goal_empty) },
      style = MaterialTheme.typography.titleMedium)
    if (summary.focusOutcome.isNotBlank()) Text(summary.focusOutcome,
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
  Row(Modifier.fillMaxWidth().padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(stringResource(R.string.personal_understanding), style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
    TextButton(onClick = onOpenUnderstanding, modifier = Modifier.testTag("personal-view-all")) {
      Text(stringResource(R.string.personal_view_all))
    }
  }
  PersonalCard(onClick = onOpenUnderstanding) {
    Text(stringResource(R.string.personal_understanding_help), style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
      CountCell(summary.counts.explicit, stringResource(R.string.personal_explicit))
      CountCell(summary.counts.learned, stringResource(R.string.personal_learned))
      CountCell(summary.counts.review, stringResource(R.string.personal_review))
    }
    Text(stringResource(R.string.personal_work_memory, summary.counts.workMemory),
      style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
  if (summary.recent.isNotEmpty()) {
    SectionHeading(stringResource(R.string.personal_recent))
    summary.recent.forEach { item -> PersonalCard(onClick = { onOpenAssertion(item.id) },
      tag = "personal-recent-${item.id}") {
      Text(item.statement, style = MaterialTheme.typography.bodyMedium, maxLines = 2,
        overflow = TextOverflow.Ellipsis)
      Text(stringResource(if (item.authority == "user_explicit") R.string.personal_explicit
        else R.string.personal_learned), style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    } }
  }
  if (summary.rules.isNotEmpty()) {
    SectionHeading(stringResource(R.string.personal_rules))
    summary.rules.forEach { rule -> PersonalCard {
      Text(rule.statement, style = MaterialTheme.typography.bodyMedium, maxLines = 3,
        overflow = TextOverflow.Ellipsis)
    } }
  }
}

@Composable
private fun SectionHeading(title: String) {
  Text(title, style = MaterialTheme.typography.labelMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = Modifier.padding(top = 24.dp, bottom = 8.dp))
}

@Composable
private fun PersonalCard(onClick: (() -> Unit)? = null, tag: String? = null,
  content: @Composable () -> Unit) {
  val modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
    .then(if (tag != null) Modifier.testTag(tag) else Modifier)
    .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
  Card(modifier, shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { content() }
  }
}

@Composable
private fun CountCell(count: Int, label: String) {
  Column(horizontalAlignment = Alignment.CenterHorizontally) {
    Text(count.toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    Text(label, style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
