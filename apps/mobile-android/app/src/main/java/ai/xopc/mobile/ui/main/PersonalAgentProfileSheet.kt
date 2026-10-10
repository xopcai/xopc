package ai.xopc.mobile.ui.main

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.PersonalProactivitySettings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PersonalAgentProfileSheet(state: PersonalUiState, onDismiss: () -> Unit,
  onLoadAgentVoices: () -> Unit,
  onUpdateAgentProfile: (String, String, Map<String, String>, String?) -> Unit,
  onLoadProactivity: suspend () -> PersonalProactivitySettings,
  onSaveProactivity: suspend (PersonalProactivitySettings) -> PersonalProactivitySettings,
  onUploadAvatar: suspend (ByteArray) -> Unit) {
  var agentName by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var agentAppearance by rememberSaveable(state.gatewayId) { mutableStateOf("loopi") }
  var agentAddress by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var agentDetail by rememberSaveable(state.gatewayId) { mutableStateOf("balanced") }
  var agentVoice by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var outreach by remember(state.gatewayId) { mutableStateOf<PersonalProactivitySettings?>(null) }
  var outreachMode by rememberSaveable(state.gatewayId) { mutableStateOf<String?>(null) }
  var loading by remember(state.gatewayId) { mutableStateOf(true) }
  var loadFailed by remember(state.gatewayId) { mutableStateOf(false) }
  var saveFailed by remember(state.gatewayId) { mutableStateOf(false) }
  var saving by remember(state.gatewayId) { mutableStateOf(false) }
  var uploading by remember(state.gatewayId) { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val busy = saving || uploading || state.agentProfileSaving
  val currentBusy by rememberUpdatedState(busy)
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true,
    confirmValueChange = { it != SheetValue.Hidden || !currentBusy })
  val agentSaveRevision = remember(state.gatewayId, state.agent?.agentId) { state.agentProfileSavedRevision }
  LaunchedEffect(state.gatewayId, state.agent?.agentId) {
    val agent = state.agent ?: return@LaunchedEffect
    agentName = agent.displayName
    agentAppearance = agent.appearance
    agentAddress = agent.userCallName ?: agent.preferences["addressAs"].orEmpty()
    agentDetail = agent.preferences["detailLevel"] ?: "balanced"
    agentVoice = agent.voicePreference?.voice.orEmpty()
  }
  suspend fun loadOutreach() {
    loading = true; loadFailed = false
    try { outreach = onLoadProactivity() }
    catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
    catch (_: Exception) { loadFailed = true }
    finally { loading = false }
  }
  LaunchedEffect(state.gatewayId) { onLoadAgentVoices(); loadOutreach() }
  LaunchedEffect(state.agentProfileSavedRevision) {
    if (state.agentProfileSavedRevision > agentSaveRevision) onDismiss()
  }
  ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheetState,
    modifier = Modifier.testTag("personal-agent-profile-sheet")) {
    Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).imePadding()) {
      Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text(stringResource(R.string.personal_agent_configure), style = MaterialTheme.typography.titleLarge)
        TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.personal_agent_done)) }
      }
      Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        PersonalAvatarUpload(state, onUploadAvatar, { agentAppearance = "custom" }, busy, { uploading = it })
        OutlinedTextField(agentName, { agentName = it.take(60) }, Modifier.fillMaxWidth(),
          label = { Text(stringResource(R.string.personal_agent_name)) }, singleLine = true, enabled = !busy)
        OutlinedTextField(agentAddress, { agentAddress = it.take(60) }, Modifier.fillMaxWidth(),
          label = { Text(stringResource(R.string.personal_agent_address)) }, singleLine = true, enabled = !busy)
        PersonalSettingsChoice(stringResource(R.string.personal_agent_detail), agentDetail,
          listOf("brief" to stringResource(R.string.personal_agent_brief),
            "balanced" to stringResource(R.string.personal_agent_balanced),
            "detailed" to stringResource(R.string.personal_agent_detailed)), !busy, { agentDetail = it })
        HorizontalDivider()
        Text(stringResource(R.string.chat_personal_outreach), style = MaterialTheme.typography.titleSmall)
        if (loading) BrandLoadingPanel()
        outreach?.let { current ->
          PersonalSettingsChoice(null, outreachMode ?: current.mode,
            listOf("off" to stringResource(R.string.chat_personal_outreach_off),
              "follow_up" to stringResource(R.string.chat_personal_outreach_followup),
              "balanced" to stringResource(R.string.chat_personal_outreach_balanced)), !busy,
            { outreachMode = it; saveFailed = false }, Modifier.testTag("personal-outreach-options"))
          Text(stringResource(R.string.personal_agent_outreach_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (loadFailed) {
          Text(stringResource(R.string.personal_agent_outreach_load_error), color = MaterialTheme.colorScheme.error)
          TextButton(onClick = { scope.launch { loadOutreach() } }, enabled = !busy && !loading) {
            Text(stringResource(R.string.personal_retry))
          }
        }
        state.agentVoiceChoices?.takeIf { it.voices.isNotEmpty() }?.let { choices ->
          HorizontalDivider()
          var expanded by remember { mutableStateOf(false) }
          val options = listOf("" to stringResource(R.string.personal_agent_default_voice)) +
            choices.voices.map { it.id to it.name } +
            state.agent?.voicePreference?.takeIf { voice -> choices.voices.none { it.id == voice.voice } }
              ?.let { listOf(it.voice to it.voice) }.orEmpty()
          Box {
            TextButton(onClick = { expanded = true }, enabled = !busy) {
              Text(stringResource(R.string.personal_agent_voice) + " · " +
                (options.firstOrNull { it.first == agentVoice }?.second ?: agentVoice))
            }
            DropdownMenu(expanded = expanded && !busy, onDismissRequest = { expanded = false }) {
              options.forEach { (id, title) ->
                DropdownMenuItem(text = { Text(title) }, onClick = { agentVoice = id; expanded = false })
              }
            }
          }
        }
        Text(stringResource(R.string.personal_agent_advanced_hint), style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      HorizontalDivider()
      Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (saveFailed || state.agentProfileError) {
          Text(stringResource(if (saveFailed) R.string.personal_agent_outreach_save_error else R.string.personal_agent_save_error),
            color = MaterialTheme.colorScheme.error)
        }
        Button(onClick = {
          scope.launch {
            saving = true; saveFailed = false
            try {
              val current = outreach
              if (current != null && outreachMode != null && outreachMode != current.mode) {
                // Keep Gateway-owned quiet hours, timezone and budgets intact.
                outreach = onSaveProactivity(current.copy(mode = outreachMode!!))
              }
              val preferences = state.agent?.preferences.orEmpty().toMutableMap().apply {
                put("addressAs", agentAddress.trim())
                put("detailLevel", agentDetail)
              }
              onUpdateAgentProfile(agentName.trim(), agentAppearance, preferences,
                agentVoice.takeIf { state.agentVoiceChoices?.voices?.isNotEmpty() == true })
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { saveFailed = true }
            finally { saving = false }
          }
        }, enabled = !busy && state.agent != null && agentName.isNotBlank(),
          modifier = Modifier.fillMaxWidth().testTag("personal-agent-profile-save")) {
          Text(stringResource(if (saving || state.agentProfileSaving) R.string.personal_agent_saving else R.string.personal_agent_save))
        }
      }
    }
  }
}

@Composable
private fun PersonalSettingsChoice(label: String?, value: String, options: List<Pair<String, String>>,
  enabled: Boolean, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
  Column(modifier.selectableGroup()) {
    if (label != null) Text(label, style = MaterialTheme.typography.titleSmall)
    options.forEach { (id, title) ->
      Row(Modifier.fillMaxWidth().selectable(selected = value == id, enabled = enabled,
        role = Role.RadioButton, onClick = { onSelect(id) }).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        RadioButton(selected = value == id, onClick = null, enabled = enabled)
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(vertical = 8.dp))
      }
    }
  }
}

@Composable
private fun PersonalAvatarUpload(state: PersonalUiState, onUpload: suspend (ByteArray) -> Unit, onUploaded: () -> Unit, disabled: Boolean,
  onBusyChange: (Boolean) -> Unit) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf(false) }
  var preview by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
  val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) scope.launch {
      busy = true; onBusyChange(true); error = false
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
      finally { busy = false; onBusyChange(false) }
    }
  }
  Row(verticalAlignment = Alignment.CenterVertically) {
    PersonalAgentAvatar(preview ?: state.agentAvatar, if (preview != null) "custom" else state.agent?.appearance ?: "loopi", 64.dp, true)
    TextButton(onClick = { picker.launch("image/*") }, enabled = !busy && !disabled) {
      Text(stringResource(R.string.chat_personal_upload_avatar))
    }
  }
  if (error) Text(stringResource(R.string.personal_agent_save_error), color = MaterialTheme.colorScheme.error)
}
