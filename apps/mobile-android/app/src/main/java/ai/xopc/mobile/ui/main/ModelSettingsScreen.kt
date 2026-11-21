package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayHttpException
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.ModelSettingsAccess
import ai.xopc.mobile.gateway.ModelSettingsSnapshot
import ai.xopc.mobile.gateway.SettingsModel
import ai.xopc.mobile.gateway.SettingsModelRoute
import ai.xopc.mobile.theme.themedCorners
import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val useLabels = mapOf(
  "chat" to R.string.ms_chat, "background" to R.string.ms_background, "vision" to R.string.ms_vision,
  "image" to R.string.ms_image, "transcription" to R.string.ms_transcription, "speech" to R.string.ms_speech,
  "conversation" to R.string.ms_conversation, "video" to R.string.ms_video, "music" to R.string.ms_music)
private val taskLabels = mapOf(
  "fast" to R.string.ms_fast, "reasoning" to R.string.ms_reasoning, "coding" to R.string.ms_coding,
  "review" to R.string.ms_review, "vision" to R.string.ms_visual_task, "understanding" to R.string.ms_understanding)

private val modelRouteIcons = mapOf(
  "chat" to R.drawable.tab_conversations,
  "background" to R.drawable.action_clock,
  "vision" to R.drawable.action_eye,
  "image" to R.drawable.action_photo,
  "transcription" to R.drawable.action_microphone,
  "speech" to R.drawable.action_speaker,
  "conversation" to R.drawable.action_waveform,
  "video" to R.drawable.action_film,
  "music" to R.drawable.action_music,
  "fast" to R.drawable.action_bolt,
  "reasoning" to R.drawable.action_lightbulb,
  "coding" to R.drawable.action_code,
  "review" to R.drawable.action_check_circle,
  "understanding" to R.drawable.material_description,
)

private data class ModelSettingsPicker(val route: SettingsModelRoute, val isTask: Boolean)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ModelSettingsScreen(profile: GatewayProfile, access: ModelSettingsAccess, insets: PaddingValues, onBack: () -> Unit) {
  val scope = rememberCoroutineScope()
  val gatewayId = profile.gatewayId
  var data by remember(gatewayId) { mutableStateOf<ModelSettingsSnapshot?>(null) }
  var loading by remember(gatewayId) { mutableStateOf(true) }
  var error by remember(gatewayId) { mutableStateOf<Int?>(null) }
  var sheetError by remember(gatewayId) { mutableStateOf(false) }
  var saving by remember(gatewayId) { mutableStateOf(false) }
  var showFallbacks by remember(gatewayId) { mutableStateOf(false) }
  var picker by remember(gatewayId) { mutableStateOf<ModelSettingsPicker?>(null) }
  var query by remember(gatewayId) { mutableStateOf("") }
  var selected by remember(gatewayId) { mutableStateOf<String?>(null) }
  val inherit = stringResource(R.string.ms_inherit)
  val language = LocalConfiguration.current.locales[0].language

  suspend fun load() {
    loading = true
    try { data = access.load(gatewayId) }
    catch (e: CancellationException) { throw e }
    catch (e: Exception) { error = if (e is GatewayHttpException && e.status == 404) R.string.ms_update_gateway else R.string.ms_load_error }
    finally { loading = false }
  }
  fun save(closePicker: Boolean, write: suspend (ModelSettingsSnapshot) -> ModelSettingsSnapshot) {
    val snapshot = data ?: return
    if (saving) return
    saving = true
    sheetError = false
    scope.launch {
      try {
        data = write(snapshot)
        error = null
        if (closePicker) picker = null
      } catch (e: CancellationException) { throw e }
      catch (e: Exception) {
        if (e is GatewayHttpException && e.status == 409) {
          picker = null
          showFallbacks = false
          data = null
          error = R.string.ms_conflict
          load()
        } else sheetError = true
      } finally { saving = false }
    }
  }
  fun open(route: SettingsModelRoute, isTask: Boolean = false) {
    query = ""
    selected = route.ref
    sheetError = false
    picker = ModelSettingsPicker(route, isTask)
  }
  LaunchedEffect(gatewayId) { load() }
  BackHandler(enabled = saving) {}
  Column(Modifier.fillMaxSize().padding(insets).testTag("model-settings")) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
      Box(Modifier.align(Alignment.CenterStart)) {
        PageBackButton("model-settings-back", onBack, !saving)
      }
      Text(stringResource(R.string.ms_title), Modifier.widthIn(max = 240.dp).padding(horizontal = 8.dp),
        style = MaterialTheme.typography.titleMedium)
    }
    val snapshot = data
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      if (error != null) item {
        Text(stringResource(error ?: R.string.ms_load_error), color = MaterialTheme.colorScheme.error)
        if (snapshot == null && !loading) TextButton(onClick = { error = null; scope.launch { load() } }) {
          Text(stringResource(R.string.ms_retry))
        }
      }
      if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
      if (snapshot != null) {
        val primary = snapshot.routing.firstOrNull { it.key == "chat" }
        item {
          Column(Modifier.padding(vertical = 4.dp)) {
            Text(profile.name, style = MaterialTheme.typography.titleSmall)
            ModelSettingsCaption(stringResource(R.string.ms_scope))
          }
        }
        item { ModelSettingsCaption(stringResource(R.string.ms_default)) }
        primary?.let { row ->
          item {
            ModelSettingsRow(stringResource(R.string.ms_chat), snapshot.modelName(row, language) ?: stringResource(R.string.ms_unset),
              modelRouteIcons.getValue(row.key), { open(row) }, primary = true)
          }
        }
        item {
          ModelSettingsRow(stringResource(R.string.ms_fallbacks), snapshot.fallbacks.size.toString(),
            R.drawable.action_task_list, { sheetError = false; showFallbacks = true })
        }
        if (snapshot.tasks.isNotEmpty()) {
          item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
              ModelSettingsCaption(stringResource(R.string.ms_tasks))
              ModelSettingsCaption(stringResource(R.string.ms_task_help))
            }
          }
          items(snapshot.tasks, key = { "task-${it.key}" }) { row ->
            ModelSettingsRow(stringResource(taskLabels.getValue(row.key)), snapshot.modelName(row, language) ?: inherit,
              modelRouteIcons.getValue(row.key), { open(row, isTask = true) })
          }
        }
        item { ModelSettingsCaption(stringResource(R.string.ms_other)) }
        items(snapshot.routing.filter { it.key in listOf("background", "vision", "image") }, key = { it.key }) { row ->
          ModelSettingsRouteRow(row, snapshot, { open(row) })
        }
        val media = snapshot.routing.filter { it.key in listOf("transcription", "speech", "conversation", "video", "music") }
        if (media.isNotEmpty()) {
          item { ModelSettingsCaption(stringResource(R.string.ms_media)) }
          items(media, key = { it.key }) { row -> ModelSettingsRouteRow(row, snapshot, { open(row) }) }
        }
      }
    }
  }

  val snapshot = data
  if ((showFallbacks || picker != null) && snapshot != null) {
    ModalBottomSheet(onDismissRequest = { if (!saving) { picker = null; showFallbacks = false } },
      sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
      val route = picker?.route
      val isTask = picker?.isTask == true
      val fallbackList = showFallbacks && route == null
      val title = if (fallbackList) R.string.ms_fallbacks else if (showFallbacks) R.string.ms_add_fallback
        else (if (isTask) taskLabels else useLabels)[route?.key] ?: R.string.ms_title
      val pool = if (showFallbacks) "chat" else route?.pool.orEmpty()
      val choices = snapshot.pools[pool].orEmpty().filter { model ->
        !showFallbacks || model.ref != snapshot.routing.firstOrNull { it.key == "chat" }?.ref &&
          snapshot.fallbacks.none { it.ref == model.ref }
      }
      val shown = choices.filter { choice ->
        listOf(choice.localizedName(language), choice.name, choice.provider, choice.ref)
          .any { it.contains(query.trim(), ignoreCase = true) }
      }
      Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(title), style = MaterialTheme.typography.titleLarge)
        if (sheetError) Text(stringResource(R.string.ms_save_error), color = MaterialTheme.colorScheme.error)
        if (fallbackList) {
          ModelSettingsCaption(stringResource(R.string.ms_fallback_help))
          LazyColumn(Modifier.weight(1f, fill = false)) {
            items(snapshot.fallbacks.size) { index ->
              val model = snapshot.fallbacks[index]
              Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${index + 1}. ${model.localizedName(language)}", Modifier.weight(1f))
                TextButton(enabled = index > 0 && !saving, onClick = {
                  val refs = snapshot.fallbacks.map(SettingsModel::ref).toMutableList()
                  refs.add(index - 1, refs.removeAt(index))
                  save(false) { access.fallbacks(gatewayId, it.revision, refs) }
                }) { Text(stringResource(R.string.ms_move_up)) }
                TextButton(enabled = !saving, onClick = {
                  val refs = snapshot.fallbacks.filter { it.ref != model.ref }.map(SettingsModel::ref)
                  save(false) { access.fallbacks(gatewayId, it.revision, refs) }
                }) { Text(stringResource(R.string.ms_remove)) }
              }
            }
          }
          Button(enabled = !saving, onClick = { open(SettingsModelRoute("fallback", "chat", null, null, false, false)) }) {
            Text(stringResource(R.string.ms_add_fallback))
          }
        } else {
          if (choices.size > 3) OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().testTag("model-settings-search"),
            placeholder = { Text(stringResource(R.string.ms_search)) }, singleLine = true)
          LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (route?.allowInherit == true) item {
              ModelSettingsChoice(inherit, "", selected == null, !saving) { selected = null }
            }
            items(shown, key = { it.ref }) { choice ->
              ModelSettingsChoice(choice.localizedName(language), choice.provider, selected == choice.ref, !saving) { selected = choice.ref }
            }
            if (shown.isEmpty()) item {
              Text(stringResource(if (choices.isEmpty()) R.string.ms_connect else R.string.ms_no_match),
                modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
            }
          }
          if (choices.isNotEmpty() || route?.allowInherit == true) Button(modifier = Modifier.fillMaxWidth(),
            enabled = !saving && selected != route?.ref, onClick = {
              val ref = selected
              if (showFallbacks && ref != null) save(true) { access.fallbacks(gatewayId, it.revision, it.fallbacks.map(SettingsModel::ref) + ref) }
              else if (route != null) save(true) { access.select(gatewayId, it.revision, isTask, route.key, ref) }
            }) { Text(stringResource(if (showFallbacks) R.string.ms_add_fallback else R.string.ms_confirm)) }
        }
        if (saving) LinearProgressIndicator(Modifier.fillMaxWidth())
      }
    }
  }
}

private fun ModelSettingsSnapshot.modelName(row: SettingsModelRoute, language: String): String? =
  pools[row.pool]?.firstOrNull { it.ref == row.ref }?.localizedName(language) ?: row.name

@Composable
private fun ModelSettingsRouteRow(row: SettingsModelRoute, snapshot: ModelSettingsSnapshot, onClick: () -> Unit) {
  val title = stringResource(useLabels.getValue(row.key))
  val value = when {
    row.inherited -> stringResource(R.string.ms_inherit)
    snapshot.pools[row.pool].isNullOrEmpty() -> stringResource(R.string.ms_not_connected)
    else -> snapshot.modelName(row, LocalConfiguration.current.locales[0].language) ?: stringResource(R.string.ms_unset)
  }
  ModelSettingsRow(title, value, modelRouteIcons.getValue(row.key), onClick)
}

@Composable
private fun ModelSettingsRow(title: String, value: String, @DrawableRes icon: Int, onClick: () -> Unit, primary: Boolean = false) {
  Card(onClick = onClick, shape = themedCorners(16), colors = CardDefaults.cardColors(containerColor =
    if (primary) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow)) {
    Row(Modifier.fillMaxWidth().heightIn(min = if (primary) 72.dp else 52.dp).padding(horizontal = 14.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      ActionIcon(icon, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (primary) {
        Column(Modifier.weight(1f)) {
          ModelSettingsCaption(title)
          Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        Text(stringResource(R.string.ms_change), color = MaterialTheme.colorScheme.primary)
      } else {
        Text(title, Modifier.weight(1f))
        ModelSettingsCaption(value)
        ActionIcon(R.drawable.action_chevron_right, size = 16.dp)
      }
    }
  }
}

@Composable
private fun ModelSettingsChoice(name: String, provider: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
  Surface(onClick = onClick, enabled = enabled, shape = themedCorners(12),
    color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
    modifier = Modifier.fillMaxWidth().semantics { this.selected = selected }) {
    Row(Modifier.heightIn(min = 50.dp).padding(horizontal = 12.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(name, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
        if (provider.isNotEmpty()) ModelSettingsCaption(provider)
      }
      if (selected) ActionIcon(R.drawable.action_check_circle, color = MaterialTheme.colorScheme.primary)
    }
  }
}

@Composable
private fun ModelSettingsCaption(text: String) {
  Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
