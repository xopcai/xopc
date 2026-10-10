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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxHeight
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

import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ai.xopc.mobile.gateway.PersonalProactivitySettings

@Composable
internal fun AgentPreferenceChoice(label: String, value: String,
  options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
  Text(label, style = MaterialTheme.typography.titleSmall)
  Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    options.forEach { (id, title) ->
      FilterChip(selected = value == id, onClick = { onSelect(id) }, label = { Text(title) })
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PersonalAgentProfileSheet(state: PersonalUiState, onDismiss: () -> Unit,
  onLoadAgentVoices: () -> Unit,
  onUpdateAgentProfile: (String, String, Map<String, String>, String?) -> Unit,
  onLoadProactivity: suspend () -> PersonalProactivitySettings,
  onSaveProactivity: suspend (PersonalProactivitySettings) -> PersonalProactivitySettings,
  onUploadAvatar: suspend (ByteArray) -> Unit, onModel: () -> Unit) {
  var agentName by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var agentAppearance by rememberSaveable(state.gatewayId) { mutableStateOf("loopi") }
  var agentAddress by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var agentWarmth by rememberSaveable(state.gatewayId) { mutableStateOf("balanced") }
  var agentSupport by rememberSaveable(state.gatewayId) { mutableStateOf("untangle") }
  var agentDetail by rememberSaveable(state.gatewayId) { mutableStateOf("balanced") }
  var agentProactivity by rememberSaveable(state.gatewayId) { mutableStateOf("decisions") }
  var agentHumor by rememberSaveable(state.gatewayId) { mutableStateOf("none") }
  var agentVoice by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  val agentSaveRevision = remember(state.gatewayId, state.agent?.agentId) { state.agentProfileSavedRevision }
  LaunchedEffect(state.agent?.agentId, state.agent?.revision) {
    val agent = state.agent ?: return@LaunchedEffect
    agentName = agent.displayName; agentAppearance = agent.appearance
    agentAddress = agent.userCallName ?: agent.preferences["addressAs"].orEmpty(); agentWarmth = agent.preferences["warmth"] ?: "balanced"
    agentSupport = agent.preferences["supportMode"] ?: "untangle"; agentDetail = agent.preferences["detailLevel"] ?: "balanced"
    agentProactivity = agent.preferences["proactivity"] ?: "decisions"; agentHumor = agent.preferences["humor"] ?: "none"
    agentVoice = agent.voicePreference?.voice.orEmpty()
  }
  LaunchedEffect(Unit) { onLoadAgentVoices() }
  LaunchedEffect(state.agentProfileSavedRevision) {
    if (state.agentProfileSavedRevision > agentSaveRevision) onDismiss()
  }
  ModalBottomSheet(onDismissRequest = {
    if (!state.agentProfileSaving) onDismiss()
  }, modifier = Modifier.testTag("personal-agent-profile-sheet")) {
    Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).imePadding().verticalScroll(rememberScrollState())
      .padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(stringResource(R.string.personal_agent_configure), style = MaterialTheme.typography.headlineSmall)
      PersonalAvatarUpload(state, onUploadAvatar, { agentAppearance = "custom" })
      OutlinedTextField(agentName, { agentName = it.take(60) }, Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.personal_agent_name)) })
      OutlinedTextField(agentAddress, { agentAddress = it.take(60) }, Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.personal_agent_address)) })
      AgentPreferenceChoice(stringResource(R.string.personal_agent_appearance), agentAppearance,
        listOf("loopi" to "Loopi", "loopi-curious" to stringResource(R.string.personal_agent_curious),
          "loopi-care" to stringResource(R.string.personal_agent_caring)) +
          if (agentAppearance == "custom") listOf("custom" to stringResource(R.string.personal_agent_custom))
          else emptyList(), { agentAppearance = it })
      AgentPreferenceChoice(stringResource(R.string.personal_agent_warmth), agentWarmth,
        listOf("reserved" to stringResource(R.string.personal_agent_reserved),
          "balanced" to stringResource(R.string.personal_agent_balanced),
          "gentle" to stringResource(R.string.personal_agent_gentle)), { agentWarmth = it })
      AgentPreferenceChoice(stringResource(R.string.personal_agent_support), agentSupport,
        listOf("listen" to stringResource(R.string.personal_agent_listen),
          "untangle" to stringResource(R.string.personal_agent_untangle),
          "solutions" to stringResource(R.string.personal_agent_solutions)), { agentSupport = it })
      AgentPreferenceChoice(stringResource(R.string.personal_agent_detail), agentDetail,
        listOf("brief" to stringResource(R.string.personal_agent_brief),
          "balanced" to stringResource(R.string.personal_agent_balanced),
          "detailed" to stringResource(R.string.personal_agent_detailed)), { agentDetail = it })
      AgentPreferenceChoice(stringResource(R.string.personal_agent_proactivity), agentProactivity,
        listOf("decisions" to stringResource(R.string.personal_agent_decisions),
          "important" to stringResource(R.string.personal_agent_important),
          "open" to stringResource(R.string.personal_agent_open_suggestions)), { agentProactivity = it })
      AgentPreferenceChoice(stringResource(R.string.personal_agent_humor), agentHumor,
        listOf("none" to stringResource(R.string.personal_agent_none),
          "occasional" to stringResource(R.string.personal_agent_occasional),
          "playful" to stringResource(R.string.personal_agent_playful)), { agentHumor = it })
      state.agentVoiceChoices?.takeIf { it.voices.isNotEmpty() }?.let { choices ->
        AgentPreferenceChoice(stringResource(R.string.personal_agent_voice), agentVoice,
          listOf("" to stringResource(R.string.personal_agent_default_voice)) +
            choices.voices.map { it.id to it.name } +
            state.agent?.voicePreference?.takeIf { current -> choices.voices.none { it.id == current.voice } }
              ?.let { listOf(it.voice to it.voice) }.orEmpty(), { agentVoice = it })
      } ?: Text(stringResource(R.string.personal_agent_voice_unavailable),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      PersonalProactivityEditor(onLoadProactivity, onSaveProactivity)
      TextButton(onClick = onModel) { Text(stringResource(R.string.chat_personal_model_thinking)) }
      if (state.agentProfileError) {
        Text(stringResource(R.string.personal_agent_save_error), color = MaterialTheme.colorScheme.error)
        TextButton(onClick = onLoadAgentVoices) { Text(stringResource(R.string.personal_retry)) }
      }
      Button(onClick = {
        val preferences = state.agent?.preferences.orEmpty().toMutableMap().apply {
          put("addressAs", agentAddress)
          put("warmth", agentWarmth)
          put("supportMode", agentSupport)
          put("detailLevel", agentDetail)
          put("proactivity", agentProactivity)
          put("humor", agentHumor)
        }
        onUpdateAgentProfile(agentName.trim(), agentAppearance, preferences,
          agentVoice.takeIf { state.agentVoiceChoices != null })
      }, enabled = !state.agentProfileSaving && agentName.isNotBlank(),
        modifier = Modifier.fillMaxWidth().testTag("personal-agent-profile-save")) {
        Text(stringResource(R.string.personal_agent_save))
      }
    }
  }
}

@Composable
private fun PersonalAvatarUpload(state: PersonalUiState, onUpload: suspend (ByteArray) -> Unit, onUploaded: () -> Unit) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf(false) }
  var preview by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
  val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) scope.launch {
      busy = true; error = false
      try {
        val image = withContext(Dispatchers.IO) {
          context.contentResolver.openInputStream(uri)?.use { stream ->
            val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeStream(stream, null, options)
            options.inJustDecodeBounds = false
            options.inSampleSize = maxOf(1, maxOf(options.outWidth, options.outHeight) / 1024)
            context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, options) }
          }
        } ?: error("INVALID_PERSONAL_AVATAR")
        val bytes = java.io.ByteArrayOutputStream().also { image.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, it) }.toByteArray()
        require(bytes.size <= 512 * 1024)
        onUpload(bytes); preview = image; onUploaded()
      } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
      catch (_: Exception) { error = true }
      finally { busy = false }
    }
  }
  Row(verticalAlignment = Alignment.CenterVertically) {
    PersonalAgentAvatar(preview ?: state.agentAvatar, if (preview != null) "custom" else state.agent?.appearance ?: "loopi", 64.dp, true)
    TextButton(onClick = { picker.launch("image/*") }, enabled = !busy && !state.agentProfileSaving) {
      Text(stringResource(R.string.chat_personal_upload_avatar))
    }
  }
  if (error) Text(stringResource(R.string.personal_agent_save_error), color = MaterialTheme.colorScheme.error)
}

@Composable
private fun PersonalProactivityEditor(onLoad: suspend () -> PersonalProactivitySettings,
  onSave: suspend (PersonalProactivitySettings) -> PersonalProactivitySettings) {
  var settings by remember { mutableStateOf<PersonalProactivitySettings?>(null) }
  var loading by remember { mutableStateOf(true) }
  var busy by remember { mutableStateOf(false) }
  var failed by remember { mutableStateOf(false) }
  var saved by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  suspend fun load() {
    loading = true; failed = false
    try { settings = onLoad() }
    catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
    catch (_: Exception) { failed = true }
    finally { loading = false }
  }
  LaunchedEffect(Unit) { load() }
  Text(stringResource(R.string.chat_personal_outreach), style = MaterialTheme.typography.titleSmall)
  if (loading) BrandLoadingPanel()
  settings?.let { current ->
    AgentPreferenceChoice(stringResource(R.string.chat_personal_outreach_mode), current.mode,
      listOf("off" to stringResource(R.string.chat_personal_outreach_off),
        "follow_up" to stringResource(R.string.chat_personal_outreach_followup),
        "balanced" to stringResource(R.string.chat_personal_outreach_balanced)),
      { settings = current.copy(mode = it); saved = false })
    AgentPreferenceChoice(stringResource(R.string.chat_personal_quiet_start), current.quietStart.toString(),
      (0..23).map { it.toString() to "%02d:00".format(it) }, { settings = current.copy(quietStart = it.toInt()); saved = false })
    AgentPreferenceChoice(stringResource(R.string.chat_personal_quiet_end), current.quietEnd.toString(),
      (0..23).map { it.toString() to "%02d:00".format(it) }, { settings = current.copy(quietEnd = it.toInt()); saved = false })
    OutlinedTextField(current.timezone, { settings = current.copy(timezone = it); saved = false },
      label = { Text(stringResource(R.string.chat_personal_timezone)) }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
    TextButton(onClick = { scope.launch {
      busy = true; failed = false
      try { settings = onSave(current.copy(timezone = current.timezone.trim())); saved = true }
      catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
      catch (_: Exception) { failed = true }
      finally { busy = false }
    } }, enabled = !busy && current.timezone.isNotBlank()) {
      Text(stringResource(if (saved) R.string.chat_personal_saved else R.string.chat_personal_outreach_save))
    }
  }
  if (failed) {
    Text(stringResource(R.string.personal_agent_save_error), color = MaterialTheme.colorScheme.error)
    TextButton(onClick = { scope.launch { load() } }, enabled = !busy) { Text(stringResource(R.string.personal_retry)) }
  }
}
