package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.PersonalAssertion
import ai.xopc.mobile.gateway.PersonalSummary
import ai.xopc.mobile.gateway.PersonalProfile
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import java.time.DateTimeException
import java.time.ZoneId

/** Plain, state-driven content shared by the Me detail navigation and UI tests. */
@Composable
@OptIn(ExperimentalMaterial3Api::class)
internal fun AboutYouScreen(state: PersonalUiState, page: String, insets: PaddingValues,
  initialSection: String,
  onBack: () -> Unit, onOpenList: () -> Unit, onOpenDetail: (String) -> Unit,
  onLoadList: (String, String, Boolean) -> Unit, onRetryDetail: () -> Unit,
  onOpenNotes: () -> Unit, onSaveProfile: (PersonalProfile) -> Unit = {},
  onSaveStatement: (String) -> Unit = {}, onDeleteAssertion: () -> Unit = {},
  onStartChat: (PersonalAssertion?) -> Unit = {}, chatBusy: Boolean = false) {
  var section by rememberSaveable(state.gatewayId) { mutableStateOf(initialSection) }
  var filter by rememberSaveable(state.gatewayId) { mutableStateOf("all") }
  var query by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var searchOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var profileEditorOpen by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var callName by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var role by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var pronouns by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var timezone by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var locale by rememberSaveable(state.gatewayId) { mutableStateOf("en") }
  var timezoneError by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var profileSaveStarted by rememberSaveable(state.gatewayId) { mutableStateOf(0) }
  fun editProfile() {
    val profile = state.summary?.profile ?: return
    callName = profile.callName
    role = profile.role
    pronouns = profile.pronouns
    timezone = profile.timezone
    locale = if (profile.locale.startsWith("zh")) "zh" else "en"
    timezoneError = false
    profileSaveStarted = state.savedProfileRevision
    profileEditorOpen = true
  }
  LaunchedEffect(initialSection) { section = initialSection }
  LaunchedEffect(state.savedProfileRevision, profileSaveStarted, profileEditorOpen) {
    if (profileEditorOpen && state.savedProfileRevision > profileSaveStarted) profileEditorOpen = false
  }
  LaunchedEffect(page, section, filter, query, state.gatewayId) {
    if (page == "about" && section == "understanding") {
      if (query.isNotBlank()) delay(300)
      onLoadList(filter, query.trim(), false)
    }
  }
  Column(Modifier.fillMaxSize().padding(insets).testTag("about-you-screen")) {
    Row(Modifier.fillMaxWidth().height(60.dp).padding(horizontal = 12.dp),
      verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = onBack, modifier = Modifier.testTag("about-you-back")) {
        Text("‹", style = MaterialTheme.typography.headlineMedium)
      }
      Text(stringResource(if (page == "detail") R.string.about_you_details else R.string.about_you_title),
        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
        modifier = Modifier.weight(1f))
      if (page == "about" && section == "understanding") TextButton(onClick = {
        searchOpen = !searchOpen
        if (!searchOpen) query = ""
      }, modifier = Modifier.testTag("about-you-search-toggle")) {
        Text(stringResource(if (searchOpen) R.string.about_you_close_search else R.string.about_you_search))
      }
    }
    if (page == "detail") {
      AssertionDetail(state, onRetryDetail, onSaveStatement, onDeleteAssertion,
        onStartChat, chatBusy)
    } else {
      Image(painterResource(R.drawable.brand_mark), contentDescription = null,
        modifier = Modifier.size(64.dp).align(Alignment.CenterHorizontally))
      Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("overview" to R.string.about_you_overview,
          "understanding" to R.string.personal_understanding).forEach { (value, label) ->
          FilterChip(selected = section == value, onClick = {
            section = value
            if (value == "understanding") onOpenList()
          }, label = { Text(stringResource(label)) },
            modifier = Modifier.weight(1f).testTag("about-you-tab-$value"))
        }
      }
      if (section == "overview") AboutOverview(state.summary,
        { section = "understanding"; onOpenList() }, onOpenDetail, onOpenNotes, ::editProfile)
      else {
        if (searchOpen) OutlinedTextField(query, { query = it.take(100) },
          modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag("about-you-search"),
          placeholder = { Text(stringResource(R.string.about_you_search)) }, singleLine = true)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
          .padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          listOf("all" to R.string.about_you_all, "explicit" to R.string.personal_explicit,
            "learned" to R.string.personal_learned, "review" to R.string.personal_review)
            .forEach { (value, label) -> FilterChip(selected = filter == value,
              onClick = { filter = value }, label = { Text(stringResource(label)) }) }
        }
        AssertionList(state, filter, query, onOpenDetail,
          onLoadMore = { onLoadList(filter, query.trim(), true) },
          onRetry = { onLoadList(filter, query.trim(), false) }, modifier = Modifier.weight(1f))
        if (state.understandingChatError) Text(stringResource(R.string.about_you_chat_error),
          color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 20.dp))
        Button(onClick = { onStartChat(null) }, enabled = !chatBusy,
          modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)
            .testTag("about-you-chat-modify")) {
          Text(stringResource(R.string.about_you_chat_modify))
        }
      }
    }
  }
  if (profileEditorOpen) ModalBottomSheet(sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    onDismissRequest = {
    if (!state.savingProfile) profileEditorOpen = false
  }, modifier = Modifier.testTag("about-you-profile-sheet")) {
    Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState())
      .padding(horizontal = 20.dp).padding(bottom = 24.dp).testTag("profile-editor-scroll"),
      verticalArrangement = Arrangement.spacedBy(14.dp)) {
      Text(stringResource(R.string.about_you_edit_profile),
        style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
      Text(stringResource(R.string.about_you_edit_profile_help),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(callName, { callName = it.take(200) }, Modifier.fillMaxWidth()
        .testTag("profile-call-name"), label = { Text(stringResource(R.string.about_you_call_name)) })
      OutlinedTextField(role, { role = it.take(200) }, Modifier.fillMaxWidth().testTag("profile-role"),
        label = { Text(stringResource(R.string.about_you_role)) })
      AboutLabel(stringResource(R.string.about_you_pronouns))
      Row(Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("" to R.string.about_you_not_set, "they" to R.string.about_you_they,
          "she" to R.string.about_you_she, "he" to R.string.about_you_he).forEach { (value, label) ->
          FilterChip(selected = pronouns == value, onClick = { pronouns = value },
            label = { Text(stringResource(label)) })
        }
      }
      OutlinedTextField(pronouns, { pronouns = it.take(200) }, Modifier.fillMaxWidth()
        .testTag("profile-pronouns"), label = { Text(stringResource(R.string.about_you_custom_pronouns)) })
      OutlinedTextField(timezone, { timezone = it.take(200); timezoneError = false },
        Modifier.fillMaxWidth().testTag("profile-timezone"),
        label = { Text(stringResource(R.string.about_you_timezone)) },
        isError = timezoneError)
      if (timezoneError) Text(stringResource(R.string.about_you_timezone_error),
        color = MaterialTheme.colorScheme.error)
      Row(Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore", "UTC")
          .forEach { value -> FilterChip(selected = timezone == value,
            onClick = { timezone = value; timezoneError = false }, label = { Text(value) }) }
      }
      AboutLabel(stringResource(R.string.about_you_language))
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = locale == "zh", onClick = { locale = "zh" },
          label = { Text(stringResource(R.string.about_you_language_zh)) })
        FilterChip(selected = locale == "en", onClick = { locale = "en" },
          label = { Text(stringResource(R.string.about_you_language_en)) })
      }
      if (state.profileError) Text(stringResource(R.string.about_you_profile_save_error),
        color = MaterialTheme.colorScheme.error)
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = { profileEditorOpen = false }, enabled = !state.savingProfile,
          modifier = Modifier.weight(1f)) { Text(stringResource(R.string.progress_cancel)) }
        Button(onClick = {
          timezoneError = !validProfileTimezone(timezone)
          if (!timezoneError) onSaveProfile(PersonalProfile(callName, role, pronouns, timezone, locale))
        }, enabled = !state.savingProfile, modifier = Modifier.weight(1f)
          .testTag("profile-save")) { Text(stringResource(R.string.progress_save)) }
      }
    }
  }
}

internal fun validProfileTimezone(value: String): Boolean = value.isBlank() || try {
  ZoneId.of(value.trim())
  true
} catch (_: DateTimeException) { false }

@Composable
private fun AboutOverview(summary: PersonalSummary?, onOpenList: () -> Unit,
  onOpenDetail: (String) -> Unit, onOpenNotes: () -> Unit, onEditProfile: () -> Unit) {
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
    .padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Text(stringResource(R.string.about_you_subtitle), style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
    AboutCard {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.about_you_basics), style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        TextButton(onClick = onEditProfile, modifier = Modifier.testTag("about-you-edit-profile")) {
          Text(stringResource(R.string.about_you_edit))
        }
      }
      Text(summary?.name.orEmpty().ifBlank { stringResource(R.string.personal_default_name) },
        style = MaterialTheme.typography.titleMedium)
      if (!summary?.role.isNullOrBlank()) Text(summary.role,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    AboutCard {
      AboutLabel(stringResource(R.string.about_you_focus))
      Text(summary?.focusTitle.orEmpty().ifBlank { stringResource(R.string.about_you_no_focus) })
      if (!summary?.focusOutcome.isNullOrBlank()) Text(summary.focusOutcome,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Card(onClick = onOpenList, modifier = Modifier.fillMaxWidth().testTag("about-you-counts"),
      colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
      shape = RoundedCornerShape(18.dp)) {
      Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AboutLabel(stringResource(R.string.personal_understanding))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          AboutCount(summary?.counts?.explicit ?: 0, stringResource(R.string.personal_explicit))
          AboutCount(summary?.counts?.learned ?: 0, stringResource(R.string.personal_learned))
          AboutCount(summary?.counts?.review ?: 0, stringResource(R.string.personal_review))
        }
      }
    }
    summary?.recent?.takeIf { it.isNotEmpty() }?.let { recent ->
      AboutLabel(stringResource(R.string.personal_recent))
      recent.forEach { AssertionRow(it, onOpenDetail) }
    }
    summary?.rules?.takeIf { it.isNotEmpty() }?.let { rules ->
      AboutLabel(stringResource(R.string.personal_rules))
      rules.forEach { rule -> AboutCard { Text(rule.statement) } }
    }
    Card(onClick = onOpenNotes, modifier = Modifier.fillMaxWidth().testTag("about-you-work-memory"),
      colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
      shape = RoundedCornerShape(18.dp)) {
      Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AboutLabel(stringResource(R.string.about_you_work_memory))
        Text(stringResource(R.string.personal_work_memory, summary?.counts?.workMemory ?: 0))
        Text(stringResource(R.string.about_you_work_memory_help), style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    Spacer(Modifier.height(24.dp))
  }
}

@Composable
private fun AssertionList(state: PersonalUiState, filter: String, query: String,
  onOpenDetail: (String) -> Unit, onLoadMore: () -> Unit, onRetry: () -> Unit,
  modifier: Modifier = Modifier) {
  Column(modifier.verticalScroll(rememberScrollState())
    .padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (state.assertionsLoading) CircularProgressIndicator(Modifier.padding(top = 24.dp).size(24.dp))
    else if (state.assertions.isEmpty() && !state.assertionsError) {
      AboutCard {
        Text(stringResource(if (query.isNotBlank()) R.string.about_you_empty_search else when (filter) {
          "review" -> R.string.about_you_empty_review
          "explicit" -> R.string.about_you_empty_explicit
          "learned" -> R.string.about_you_empty_learned
          else -> R.string.about_you_empty_all
        }))
      }
    }
    state.assertions.forEach { AssertionRow(it, onOpenDetail) }
    if (state.assertionsError) {
      Text(stringResource(R.string.about_you_load_error),
        color = MaterialTheme.colorScheme.error)
      TextButton(onClick = onRetry) { Text(stringResource(R.string.personal_retry)) }
    }
    if (state.assertionCursor != null && !state.assertionsMoreLoading) TextButton(onClick = onLoadMore,
      modifier = Modifier.testTag("about-you-load-more")) { Text(stringResource(R.string.about_you_load_more)) }
    if (state.assertionsMoreLoading) CircularProgressIndicator(Modifier.size(24.dp))
    Spacer(Modifier.height(24.dp))
  }
}

@Composable
private fun AssertionRow(item: PersonalAssertion, onOpenDetail: (String) -> Unit) {
  Card(onClick = { onOpenDetail(item.id) }, modifier = Modifier.fillMaxWidth()
    .testTag("assertion-${item.id}"),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    shape = RoundedCornerShape(16.dp)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(item.statement, maxLines = 3, overflow = TextOverflow.Ellipsis)
      Text(stringResource(if (item.status == "needs_review" || item.status == "conflicted")
        R.string.personal_review else if (item.authority == "user_explicit")
        R.string.personal_explicit else R.string.personal_learned),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun AssertionDetail(state: PersonalUiState, onRetry: () -> Unit,
  onSaveStatement: (String) -> Unit, onDeleteAssertion: () -> Unit,
  onStartChat: (PersonalAssertion?) -> Unit, chatBusy: Boolean) {
  val item = state.selectedAssertion
  var editing by rememberSaveable(state.selectedAssertionId) { mutableStateOf(false) }
  var draft by rememberSaveable(state.selectedAssertionId) { mutableStateOf(item?.statement.orEmpty()) }
  var confirmDelete by rememberSaveable(state.selectedAssertionId) { mutableStateOf(false) }
  var saveStartedRevision by rememberSaveable(state.selectedAssertionId) {
    mutableStateOf(state.assertionSavedRevision)
  }
  LaunchedEffect(state.assertionSavedRevision, saveStartedRevision) {
    if (editing && state.assertionSavedRevision > saveStartedRevision) editing = false
  }
  Column(Modifier.fillMaxSize().padding(horizontal = 20.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (state.assertionDetailLoading) CircularProgressIndicator(Modifier.size(24.dp))
    else if (state.assertionDetailError || item == null) {
      Text(stringResource(R.string.about_you_detail_error), color = MaterialTheme.colorScheme.error)
      TextButton(onClick = onRetry) { Text(stringResource(R.string.personal_retry)) }
    } else {
      Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AboutCard {
          AboutLabel(stringResource(R.string.about_you_statement))
          if (editing) {
            Text(stringResource(R.string.about_you_edit_statement_help),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(draft, { draft = it.take(10_000) },
              Modifier.fillMaxWidth().height(220.dp).testTag("about-you-statement-input"))
          } else Text(item.statement, style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.testTag("about-you-detail-statement"))
        }
        AboutCard {
          AboutLabel(stringResource(R.string.about_you_metadata))
          AboutDetailRow(stringResource(R.string.about_you_source), item.sources.joinToString(" · ")
            .ifBlank { stringResource(R.string.about_you_system_inference) })
          AboutDetailRow(stringResource(R.string.about_you_scope), item.scope)
          AboutDetailRow(stringResource(R.string.about_you_confidence),
            "${(item.confidence * 100).roundToInt()}%")
        }
      }
      if (state.assertionSaveError) Text(stringResource(R.string.about_you_change_error),
        color = MaterialTheme.colorScheme.error)
      if (state.understandingChatError) Text(stringResource(R.string.about_you_chat_error),
        color = MaterialTheme.colorScheme.error)
      if (!editing) Button(onClick = { onStartChat(item) }, enabled = !chatBusy,
        modifier = Modifier.fillMaxWidth().testTag("about-you-detail-chat")) {
        Text(stringResource(R.string.about_you_chat_modify))
      }
      Row(Modifier.fillMaxWidth().padding(bottom = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (editing) {
          TextButton(onClick = { draft = item.statement; editing = false },
            enabled = !state.assertionSaving, modifier = Modifier.weight(1f)) {
            Text(stringResource(R.string.progress_cancel))
          }
          Button(onClick = { onSaveStatement(draft) }, enabled = draft.isNotBlank() &&
            !state.assertionSaving, modifier = Modifier.weight(1f)
            .testTag("about-you-save-statement")) { Text(stringResource(R.string.progress_save)) }
        } else {
          Button(onClick = {
            draft = item.statement
            saveStartedRevision = state.assertionSavedRevision
            editing = true
          }, modifier = Modifier.weight(1f).testTag("about-you-edit-statement")) {
            Text(stringResource(R.string.about_you_edit))
          }
          TextButton(onClick = { confirmDelete = true }, enabled = !state.assertionSaving,
            modifier = Modifier.weight(1f).testTag("about-you-delete-statement")) {
            Text(stringResource(R.string.about_you_delete), color = MaterialTheme.colorScheme.error)
          }
        }
      }
    }
  }
  if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false },
    title = { Text(stringResource(R.string.about_you_delete_title)) },
    text = { Text(stringResource(R.string.about_you_delete_help)) },
    confirmButton = { TextButton(onClick = { confirmDelete = false; onDeleteAssertion() },
      modifier = Modifier.testTag("about-you-confirm-delete")) {
      Text(stringResource(R.string.about_you_delete), color = MaterialTheme.colorScheme.error)
    } }, dismissButton = { TextButton(onClick = { confirmDelete = false }) {
      Text(stringResource(R.string.progress_cancel))
    } })
}

@Composable private fun AboutDetailRow(label: String, value: String) {
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    AboutLabel(label)
    Text(value)
  }
}

@Composable private fun AboutLabel(label: String) {
  Text(label, style = MaterialTheme.typography.labelMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun AboutCount(count: Int, label: String) {
  Column {
    Text(count.toString(), style = MaterialTheme.typography.headlineSmall,
      fontWeight = FontWeight.Bold)
    AboutLabel(label)
  }
}

@Composable private fun AboutCard(content: @Composable () -> Unit) {
  Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(
    containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    shape = RoundedCornerShape(18.dp)) {
    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
  }
}
