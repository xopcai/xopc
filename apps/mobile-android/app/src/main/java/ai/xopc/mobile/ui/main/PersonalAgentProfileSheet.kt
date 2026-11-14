package ai.xopc.mobile.ui.main

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationModel
import ai.xopc.mobile.gateway.ModelSelection

internal typealias LoadPersonalModel = suspend (gatewayId: String, conversationId: String) -> ModelSelection
internal typealias SavePersonalModel = suspend (gatewayId: String, conversationId: String, model: ConversationModel,
  configVersion: Long?) -> ModelSelection

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PersonalAgentProfileSheet(state: PersonalUiState, onDismiss: () -> Unit,
  onLoadAgentVoices: () -> Unit,
  onUpdateAgentProfile: (String, String, String?, Boolean, String) -> Unit,
  onUploadAvatar: suspend (ByteArray) -> Unit,
  onLoadModel: LoadPersonalModel? = null, onSaveModel: SavePersonalModel? = null,
  modelBusy: Boolean = false) {
  var agentName by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var agentAppearance by rememberSaveable(state.gatewayId) { mutableStateOf("loopi") }
  var callEngine by rememberSaveable(state.gatewayId) { mutableStateOf("auto") }
  var voiceExpanded by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var greetingEnabled by rememberSaveable(state.gatewayId) { mutableStateOf(true) }
  var agentVoice by rememberSaveable(state.gatewayId) { mutableStateOf("") }
  var uploading by remember(state.gatewayId) { mutableStateOf(false) }
  val gatewayId = state.gatewayId
  val conversationId = state.agent?.conversationId
  val scope = rememberCoroutineScope()
  var modelSelection by remember(state.gatewayId, conversationId) { mutableStateOf<ModelSelection?>(null) }
  var modelError by remember(state.gatewayId, conversationId) { mutableStateOf(false) }
  var modelSaving by remember(state.gatewayId, conversationId) { mutableStateOf(false) }
  var modelPickerOpen by rememberSaveable(state.gatewayId, conversationId) { mutableStateOf(false) }
  var query by rememberSaveable(state.gatewayId, conversationId) { mutableStateOf("") }
  suspend fun reloadModels() {
    val targetGateway = gatewayId ?: return
    val targetConversation = conversationId ?: return
    val load = onLoadModel ?: return
    modelSelection = null
    modelError = false
    try {
      modelSelection = load(targetGateway, targetConversation)
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      modelError = true
    }
  }
  fun saveModel(model: ConversationModel) {
    val targetGateway = gatewayId ?: return
    val targetConversation = conversationId ?: return
    val save = onSaveModel ?: return
    val current = modelSelection ?: return
    if (modelSaving || modelBusy || modelError) return
    modelSaving = true
    scope.launch {
      try {
        val saved = save(targetGateway, targetConversation, model, current.configVersion)
        modelSelection = saved.copy(models = current.models)
        modelPickerOpen = false
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (_: Exception) {
        modelError = true
      } finally {
        modelSaving = false
      }
    }
  }
  LaunchedEffect(state.gatewayId, conversationId) { reloadModels() }
  val busy = uploading || state.agentProfileSaving || modelSaving
  val currentBusy by rememberUpdatedState(busy)
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true,
    confirmValueChange = { it != SheetValue.Hidden || !currentBusy })
  fun saveProfile() {
    val agent = state.agent ?: return
    if (state.agentLoading || state.agentProfileSaving) return
    onUpdateAgentProfile(agentName.trim().ifBlank { agent.displayName }, agentAppearance,
      agentVoice.takeIf { state.agentVoiceChoices?.voices?.isNotEmpty() == true }, greetingEnabled, callEngine)
  }
  LaunchedEffect(state.gatewayId, state.agent?.agentId, state.agent?.revision) {
    val agent = state.agent ?: return@LaunchedEffect
    callEngine = agent.callEngine ?: "auto"
    greetingEnabled = agent.openingGreetingEnabled
    agentName = agent.displayName
    agentAppearance = agent.appearance
    agentVoice = agent.voicePreference?.voice?.takeUnless { it == "default" }.orEmpty()
  }
  LaunchedEffect(state.gatewayId) { onLoadAgentVoices() }
  val pendingName = agentName.isNotBlank() && state.agent != null && agentName.trim() != state.agent.displayName
  LaunchedEffect(agentName, pendingName) {
    if (pendingName && !state.agentProfileError) {
      delay(700)
      saveProfile()
    }
  }
  val closeProfile = {
    if (!busy) {
      if (pendingName && !state.agentProfileError) saveProfile()
      onDismiss()
    }
  }
  val closePicker = { if (!modelSaving) modelPickerOpen = false }
  ModalBottomSheet(onDismissRequest = closeProfile, sheetState = sheetState,
    modifier = Modifier.testTag("personal-agent-profile-sheet")) {
    val selection = modelSelection
    val model = selection?.models?.firstOrNull { it.id == selection.selectedId }
    if (modelPickerOpen) {
      ChatOptionsPanel(stringResource(R.string.assistant_model), height = 576.dp, onClose = closePicker) {
        OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth(),
          label = { Text(stringResource(R.string.assistant_model_search)) }, singleLine = true)
        if (modelError) {
          Text(stringResource(R.string.assistant_model_error), color = MaterialTheme.colorScheme.error)
          TextButton(onClick = { scope.launch { reloadModels() } }, enabled = !modelSaving) {
            Text(stringResource(R.string.assistant_model_retry))
          }
        } else if (selection == null) ChatOptionsSkeleton()
        val canSelect = !modelBusy && !modelSaving && !modelError
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          if (selection != null) items(selection.models.filter {
            query.isBlank() || it.name.contains(query, true) || it.id.contains(query, true)
          }, key = { it.id }) { option ->
            ContextRow("${if (option.id == selection.selectedId) "✓ " else ""}${option.name}", option.id,
              "personal-model-${option.id}", enabled = canSelect, flat = true, showChevron = false) {
              if (option.id == selection.selectedId) closePicker() else saveModel(model = option)
            }
          }
        }
      }
    } else {
      Column(Modifier.fillMaxWidth().fillMaxHeight(0.65f).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp),
          horizontalArrangement = Arrangement.End) {
          TextButton(onClick = closeProfile, enabled = !busy) { Text(stringResource(R.string.personal_agent_done)) }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),
          verticalArrangement = Arrangement.spacedBy(16.dp)) {
          PersonalAvatarUpload(state, onUploadAvatar, { agentAppearance = "custom"; saveProfile() }, busy || state.agentLoading, { uploading = it })
          OutlinedTextField(agentName, { agentName = it.take(60) }, Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.personal_agent_name)) }, singleLine = true, enabled = !busy && !state.agentLoading)
          if (onLoadModel != null && onSaveModel != null && gatewayId != null && conversationId != null) {
            HorizontalDivider()
            Text(stringResource(R.string.personal_agent_chat_model), style = MaterialTheme.typography.titleSmall)
            when {
              modelError -> {
                Text(stringResource(R.string.assistant_model_error), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { scope.launch { reloadModels() } }, enabled = !busy) {
                  Text(stringResource(R.string.assistant_model_retry))
                }
              }
              selection == null -> ChatOptionsSkeleton()
              selection.models.isEmpty() -> Text(stringResource(R.string.personal_agent_no_models),
                color = MaterialTheme.colorScheme.onSurfaceVariant)
              else -> {
                ContextRow(stringResource(R.string.assistant_model), model?.name ?: selection.selectedId,
                  "personal-setting-model", enabled = !busy && !modelBusy, compact = true, flat = true) {
                  query = ""
                  modelPickerOpen = true
                }
              }
            }
          }
          HorizontalDivider()
          Text(stringResource(R.string.personal_agent_calls), style = MaterialTheme.typography.titleSmall)
          var selectingEngine by remember { mutableStateOf(false) }
          val engines = listOf("auto" to R.string.personal_agent_call_auto,
            "natural" to R.string.personal_agent_call_natural, "assistant" to R.string.personal_agent_call_assistant)
          Box {
            ContextRow(stringResource(R.string.personal_agent_call_mode),
              stringResource(engines.first { it.first == callEngine }.second),
              "personal-setting-call-mode", enabled = !busy, compact = true, flat = true) {
              selectingEngine = true
            }
            DropdownMenu(expanded = selectingEngine && !busy, onDismissRequest = { selectingEngine = false }) {
              engines.forEach { (engine, label) ->
                DropdownMenuItem(text = { Text(stringResource(label)) },
                  onClick = { callEngine = engine; selectingEngine = false; saveProfile() },
                  modifier = Modifier.testTag("personal-call-mode-$engine"))
              }
            }
          }
          if (callEngine != "natural") {
            ContextRow(stringResource(R.string.personal_agent_voice_details), "",
              "personal-setting-voice-details", enabled = !busy, compact = true, flat = true, showChevron = false,
              iconRes = if (voiceExpanded) R.drawable.action_chevron_down else R.drawable.action_chevron_right) {
              voiceExpanded = !voiceExpanded
            }
            if (voiceExpanded) {
              state.agentVoiceChoices?.takeIf { it.voices.isNotEmpty() }?.let { choices ->
                var expanded by remember { mutableStateOf(false) }
                val options = listOf("" to stringResource(R.string.personal_agent_default_voice)) +
                  choices.voices.filter { it.id != "default" }.map {
                    it.id to (it.displayNames[if (Locale.current.language == "zh") "zh-CN" else "en"] ?: it.name)
                  } +
                  state.agent?.voicePreference?.takeIf { voice -> voice.voice != "default" && choices.voices.none { it.id == voice.voice } }
                    ?.let { listOf(it.voice to it.voice) }.orEmpty()
                Box {
                  TextButton(onClick = { expanded = true }, enabled = !busy) {
                    Text(stringResource(R.string.personal_agent_voice) + " · " +
                      (options.firstOrNull { it.first == agentVoice }?.second ?: agentVoice))
                  }
                  DropdownMenu(expanded = expanded && !busy, onDismissRequest = { expanded = false }) {
                    options.forEach { (id, title) ->
                      DropdownMenuItem(text = { Text(title) }, onClick = { agentVoice = id; expanded = false; saveProfile() })
                    }
                  }
                }
              }
              if (state.agent?.supportsOpeningGreeting == true) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.personal_agent_opening_greeting), Modifier.weight(1f))
                androidx.compose.material3.Switch(checked = greetingEnabled,
                  onCheckedChange = { greetingEnabled = it; saveProfile() }, enabled = !busy && !state.agentLoading)
              }
              if (state.agentVoiceChoices?.voices.isNullOrEmpty()) {
                TextButton(onClick = onLoadAgentVoices, enabled = !busy) {
                  Text(stringResource(R.string.personal_agent_refresh_voices))
                }
              }
            }
          }
          if (state.agentProfileSaving) {
            Text(stringResource(R.string.personal_agent_saving), color = MaterialTheme.colorScheme.onSurfaceVariant)
          } else if (state.agentProfileError) {
            Text(stringResource(R.string.personal_agent_save_error), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { saveProfile() }, enabled = agentName.isNotBlank()) {
              Text(stringResource(R.string.personal_retry))
            }
          }
        }
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
  val uploadLabel = stringResource(R.string.chat_personal_upload_avatar)
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
    PersonalAgentAvatar(preview ?: state.agentAvatar, if (preview != null) "custom" else state.agent?.appearance ?: "loopi", 64.dp, true,
      modifier = Modifier.testTag("personal-setting-avatar").semantics { contentDescription = uploadLabel }
        .clickable(enabled = !busy && !disabled, role = Role.Button) { picker.launch("image/*") })
  }
  if (error) Text(stringResource(R.string.personal_agent_save_error), color = MaterialTheme.colorScheme.error)
}
