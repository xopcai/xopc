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
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
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
  val navigation = rememberNavigationPreferences()
  var tasks by rememberSaveable(gatewayId) {
    mutableStateOf(navigation.selection("model-settings", listOf("defaults", "tasks"), "defaults") == "tasks")
  }
  fun selectTasks(selected: Boolean) {
    tasks = selected
    navigation.rememberSelection("model-settings", if (selected) "tasks" else "defaults")
  }
  var showMedia by rememberSaveable(gatewayId) { mutableStateOf(false) }
  var showFallbacks by remember(gatewayId) { mutableStateOf(false) }
  var picker by remember(gatewayId) { mutableStateOf<SettingsModelRoute?>(null) }
  var query by remember(gatewayId) { mutableStateOf("") }
  var selected by remember(gatewayId) { mutableStateOf<String?>(null) }
  val inherit = stringResource(R.string.ms_inherit)

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
  fun open(route: SettingsModelRoute) {
    query = ""
    selected = route.ref
    sheetError = false
    picker = route
  }
  LaunchedEffect(gatewayId) { load() }
  BackHandler(enabled = saving) {}
  Column(Modifier.fillMaxSize().padding(insets).testTag("model-settings")) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
      Box(Modifier.align(Alignment.CenterStart)) {
        PageBackButton("model-settings-back", onBack, !saving)
      }
      PageTitleMenu(listOf(
        SegmentOption(false, stringResource(R.string.ms_title), "model-page-default"),
        SegmentOption(true, stringResource(R.string.ms_tasks), "model-page-tasks")),
        tasks, "model-settings-menu", Modifier.fillMaxWidth(0.65f), ::selectTasks)
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
        if (tasks) {
          item { ModelSettingsCaption(stringResource(R.string.ms_task_help)) }
          items(snapshot.tasks, key = { it.key }) { row ->
            ModelSettingsRow(stringResource(taskLabels.getValue(row.key)), row.name ?: inherit, { open(row) })
          }
        } else {
          item {
            Column(Modifier.padding(vertical = 4.dp)) {
              Text(profile.name, style = MaterialTheme.typography.titleSmall)
              ModelSettingsCaption(stringResource(R.string.ms_scope))
            }
          }
          item { ModelSettingsCaption(stringResource(R.string.ms_default)) }
          primary?.let { row ->
            item {
              ModelSettingsRow(stringResource(R.string.ms_chat), row.name ?: stringResource(R.string.ms_unset),
                { open(row) }, primary = true)
            }
          }
          item {
            ModelSettingsRow(stringResource(R.string.ms_fallbacks), snapshot.fallbacks.size.toString(),
              { sheetError = false; showFallbacks = true })
          }
          item { ModelSettingsRow(stringResource(R.string.ms_tasks), snapshot.tasks.count { !it.inherited }.toString(), { selectTasks(true) }) }
          item { ModelSettingsCaption(stringResource(R.string.ms_other)) }
          items(snapshot.routing.filter { it.key in listOf("background", "vision", "image") }, key = { it.key }) { row ->
            ModelSettingsRouteRow(row, snapshot, { open(row) })
          }
          item { ModelSettingsRow(stringResource(R.string.ms_media), "", { showMedia = !showMedia }, expanded = showMedia) }
          if (showMedia) items(snapshot.routing.filter { it.key in listOf("transcription", "speech", "conversation", "video", "music") },
            key = { it.key }) { row -> ModelSettingsRouteRow(row, snapshot, { open(row) }) }
        }
      }
    }
  }

  val snapshot = data
  if ((showFallbacks || picker != null) && snapshot != null) {
    ModalBottomSheet(onDismissRequest = { if (!saving) { picker = null; showFallbacks = false } },
      sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
      val route = picker
      val fallbackList = showFallbacks && route == null
      val title = if (fallbackList || showFallbacks) R.string.ms_fallbacks
        else (if (tasks) taskLabels else useLabels)[route?.key] ?: R.string.ms_title
      val pool = if (showFallbacks) "chat" else route?.pool.orEmpty()
      val choices = snapshot.pools[pool].orEmpty().filter { model ->
        !showFallbacks || model.ref != snapshot.routing.firstOrNull { it.key == "chat" }?.ref &&
          snapshot.fallbacks.none { it.ref == model.ref }
      }
      val shown = choices.filter { query.isBlank() || "${it.name} ${it.provider} ${it.ref}".contains(query.trim(), ignoreCase = true) }
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
                Text("${index + 1}. ${model.name}", Modifier.weight(1f))
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
          if (choices.isNotEmpty()) OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().testTag("model-settings-search"),
            placeholder = { Text(stringResource(R.string.ms_search)) }, singleLine = true)
          LazyColumn(Modifier.weight(1f, fill = false)) {
            if (route?.allowInherit == true) item {
              ModelSettingsChoice(inherit, "", selected == null, !saving) { selected = null }
            }
            items(shown, key = { it.ref }) { choice ->
              ModelSettingsChoice(choice.name, choice.provider, selected == choice.ref, !saving) { selected = choice.ref }
            }
            if (shown.isEmpty()) item {
              ModelSettingsCaption(stringResource(if (choices.isEmpty()) R.string.ms_connect else R.string.ms_no_match))
            }
          }
          if (choices.isNotEmpty() || route?.allowInherit == true) Button(modifier = Modifier.fillMaxWidth(),
            enabled = !saving && selected != route?.ref, onClick = {
              val ref = selected
              if (showFallbacks && ref != null) save(true) { access.fallbacks(gatewayId, it.revision, it.fallbacks.map(SettingsModel::ref) + ref) }
              else if (route != null) save(true) { access.select(gatewayId, it.revision, tasks, route.key, ref) }
            }) { Text(stringResource(if (showFallbacks) R.string.ms_add_fallback else R.string.ms_confirm)) }
        }
        if (saving) LinearProgressIndicator(Modifier.fillMaxWidth())
      }
    }
  }
}

@Composable
private fun ModelSettingsRouteRow(row: SettingsModelRoute, snapshot: ModelSettingsSnapshot, onClick: () -> Unit) {
  val title = stringResource(useLabels.getValue(row.key))
  val value = when {
    row.inherited -> stringResource(R.string.ms_inherit)
    snapshot.pools[row.pool].isNullOrEmpty() -> stringResource(R.string.ms_not_connected)
    else -> row.name ?: stringResource(R.string.ms_unset)
  }
  ModelSettingsRow(title, value, onClick)
}

@Composable
private fun ModelSettingsRow(title: String, value: String, onClick: () -> Unit, primary: Boolean = false, expanded: Boolean? = null) {
  Card(onClick = onClick, shape = themedCorners(16), colors = CardDefaults.cardColors(containerColor =
    if (primary) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow)) {
    Row(Modifier.fillMaxWidth().heightIn(min = if (primary) 72.dp else 52.dp).padding(horizontal = 14.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      if (primary) {
        Column(Modifier.weight(1f)) {
          ModelSettingsCaption(title)
          Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        Text(stringResource(R.string.ms_change), color = MaterialTheme.colorScheme.primary)
      } else {
        Text(title, Modifier.weight(1f))
        ModelSettingsCaption(value)
        ActionIcon(when (expanded) { null -> R.drawable.action_chevron_right; else -> R.drawable.action_chevron_down }, size = 16.dp)
      }
    }
  }
}

@Composable
private fun ModelSettingsChoice(name: String, provider: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
  TextButton(enabled = enabled, onClick = onClick, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) {
    Column(Modifier.weight(1f)) {
      Text(name, color = MaterialTheme.colorScheme.onSurface)
      if (provider.isNotEmpty()) ModelSettingsCaption(provider)
    }
    if (selected) Text("✓")
  }
}

@Composable
private fun ModelSettingsCaption(text: String) {
  Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
