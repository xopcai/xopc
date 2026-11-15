package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.CapabilityItem
import ai.xopc.mobile.gateway.CapabilityPage
import ai.xopc.mobile.gateway.ConversationAgent
import ai.xopc.mobile.gateway.GatewayHttpException
import android.graphics.Bitmap
import android.net.Uri
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import androidx.compose.foundation.Image
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import kotlinx.coroutines.launch

private enum class CapabilityCategory(val key: String, val title: Int, val icon: Int, val tabWidth: Int = 56) {
  Plugins("plugins", R.string.capability_plugins, R.drawable.action_capabilities),
  Skills("skills", R.string.capability_skills, R.drawable.action_task_list),
  Connections("connections", R.string.capability_connections, R.drawable.action_phone),
  Agents("agents", R.string.capability_agents, R.drawable.tab_assistant, 86),
  Channels("channels", R.string.capability_channels, R.drawable.tab_conversations, 74),
}

private val capabilityGroups = listOf("attention", "assistant", "expert", "connected", "installed", "configured", "disabled", "available")

private fun capabilityGroup(group: String) = when (group) {
  "assistant" -> R.string.capability_my_assistants
  "expert" -> R.string.capability_experts
  "installed" -> R.string.capability_installed
  "configured" -> R.string.capability_configured
  "connected" -> R.string.capability_connected
  "attention" -> R.string.capability_attention
  "disabled" -> R.string.capability_disabled
  else -> R.string.capability_available
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CapabilitiesScreen(insets: PaddingValues, personal: PersonalUiState,
  agentAvatars: Map<String, Bitmap>,
  onLoad: suspend (String) -> CapabilityPage, onOpenAgent: (CapabilityItem) -> Unit,
  onExit: () -> Unit, onSetupChat: (String, Boolean) -> Unit,
  onPanel: suspend (String, String, JSONObject?) -> JSONObject) {
  var category by remember { mutableStateOf(CapabilityCategory.Plugins) }
  var pages by remember { mutableStateOf(emptyMap<CapabilityCategory, CapabilityPage>()) }
  var failed by remember { mutableStateOf(false) }
  var loading by remember { mutableStateOf(true) }
  var retry by remember { mutableStateOf(0) }
  var query by remember(category) { mutableStateOf("") }
  var detail by remember(category) { mutableStateOf<CapabilityItem?>(null) }
  val list = rememberLazyListState()
  val keyboard = LocalSoftwareKeyboardController.current
  val focus = LocalFocusManager.current
  val searchFocus = remember { FocusRequester() }

  LaunchedEffect(category, retry) {
    val requested = category
    loading = true
    failed = false
    try {
      val page = onLoad(requested.key)
      pages = pages + (requested to page)
    } catch (error: CancellationException) { throw error }
    catch (_: Exception) { failed = true }
    finally { loading = false }
  }
  LaunchedEffect(category, query) { list.requestScrollToItem(0) }
  val page = pages[category]
  val agent = personal.agent?.takeIf { it.state == "ready" && category == CapabilityCategory.Agents }
  val rows = page?.items.orEmpty().filterNot { it.id == agent?.agentId }.map { item ->
    if (category != CapabilityCategory.Agents) item
    else {
      val profile = ConversationAgent(item.id, item.name, item.description)
      item.copy(name = agentDisplayName(profile), description = agentDisplayDescription(profile))
    }
  }
  val entries = rows.let {
    if (agent == null) rows else listOf(CapabilityItem(
      agent.agentId, agent.displayName, stringResource(R.string.capability_personal_description), "assistant", personal = true,
    )) + rows
  }
  val search = query.trim()
  val groups = entries.filter { row ->
    search.isEmpty() || listOf(row.name, row.id, row.description).any { it.contains(search, ignoreCase = true) }
  }.groupBy { it.group }
  val colors = MaterialTheme.colorScheme
  val origin = page?.origin
  val skills = category == CapabilityCategory.Skills
  val agents = category == CapabilityCategory.Agents
  val connections = category == CapabilityCategory.Connections
  val plugins = category == CapabilityCategory.Plugins
  val skillMarketTitle = stringResource(R.string.capability_skill_market)
  val pageSwipeDistance = with(LocalDensity.current) { 40.dp.toPx() }
  val selectCategory: (CapabilityCategory) -> Unit = {
    if (it != category) {
      focus.clearFocus()
      keyboard?.hide()
      category = it
    }
  }

  Column(Modifier.fillMaxSize().background(colors.background).padding(insets).imePadding().padding(horizontal = 18.dp)) {
    Box(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp), contentAlignment = Alignment.Center) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PageBackButton("capability-back", onExit)
        Spacer(Modifier.weight(1f))
        if (skills) {
          IconButton(onClick = {
            focus.clearFocus()
            keyboard?.hide()
            detail = CapabilityItem("marketplace:search", skillMarketTitle, group = "available")
          }, modifier = Modifier.size(44.dp).background(colors.primaryContainer, CircleShape).testTag("capability-add-skills")) {
            ActionIcon(R.drawable.action_search, color = colors.primary, contentDescription = skillMarketTitle)
          }
        } else if (plugins) {
          IconButton(onClick = {
            searchFocus.requestFocus()
            keyboard?.show()
          }, modifier = Modifier.size(44.dp).background(colors.primaryContainer, CircleShape)
            .testTag("capability-add-plugins")) {
            ActionIcon(R.drawable.action_search, color = colors.primary, contentDescription = stringResource(R.string.capability_search_plugins))
          }
        }
        if (skills || agents || connections) {
          val label = stringResource(when {
            agents -> R.string.capability_create_agent
            skills -> R.string.capability_create_skill
            else -> R.string.capability_add_mcp
          })
          val prompt = stringResource(when {
            agents -> R.string.capability_agent_setup_prompt
            skills -> R.string.capability_skill_setup_prompt
            else -> R.string.capability_mcp_setup_prompt
          })
          IconButton(onClick = {
            focus.clearFocus()
            keyboard?.hide()
            onSetupChat(prompt, agents)
          }, modifier = Modifier.size(44.dp).background(colors.primaryContainer, CircleShape)
            .testTag("capability-chat-setup-${category.key}")) {
            ActionIcon(R.drawable.action_add, color = colors.primary, contentDescription = label)
          }
        }
      }
      PageTitleMenu(CapabilityCategory.entries.map {
        SegmentOption(it, stringResource(it.title), "capability-category-${it.key}")
      }, category, "capability-title", Modifier.fillMaxWidth(0.48f), selectCategory)
    }
    Column(Modifier.weight(1f).fillMaxWidth().horizontalSwipe(enabled = detail == null, onRelease = { distance, _ ->
      if (distance <= -pageSwipeDistance) CapabilityCategory.entries.getOrNull(category.ordinal + 1)?.let(selectCategory)
      if (distance >= pageSwipeDistance) CapabilityCategory.entries.getOrNull(category.ordinal - 1)?.let(selectCategory)
    })) {
      LazyColumn(state = list, modifier = Modifier.weight(1f), contentPadding = PaddingValues(top = 4.dp, bottom = 4.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (loading && page == null) item { BrandLoadingPanel() }
        if (failed || page?.incomplete == true) item {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(if (failed) R.string.capability_load_failed else R.string.capability_partial), Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { retry++ }) { Text(stringResource(R.string.capability_retry)) }
          }
        }
        if (!loading && !failed && groups.isEmpty()) item {
          Column(Modifier.fillMaxWidth().padding(top = 56.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            ActionIcon(R.drawable.action_search)
            Text(stringResource(if (search.isEmpty()) R.string.capability_empty else R.string.capability_no_matches),
              modifier = Modifier.padding(top = 8.dp).testTag("capability-empty"))
            if (search.isNotEmpty()) TextButton(onClick = { query = "" }) { Text(stringResource(R.string.capability_clear)) }
          }
        }
        capabilityGroups.forEach { group ->
          val rows = groups[group] ?: return@forEach
          item("group-$group") {
            Text(stringResource(capabilityGroup(group)), style = MaterialTheme.typography.labelLarge,
              color = colors.onSurfaceVariant, modifier = Modifier.padding(top = 14.dp, bottom = 2.dp, start = 4.dp))
          }
          items(rows, key = { it.id }) { row ->
            Row(Modifier.fillMaxWidth().heightIn(min = 76.dp).clip(themedCorners(18)).background(colors.surface)
              .clickable { focus.clearFocus(); keyboard?.hide(); detail = row }.testTag("capability-row-${row.id}")
              .padding(horizontal = 14.dp, vertical = 12.dp),
              verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
              CapabilityItemIcon(row, category, origin, personal, agentAvatars)
              Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(row.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (row.description.isNotBlank()) Text(row.description, style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
              }
              ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 14.dp)
            }
          }
        }
      }
    }
    TextField(query, { query = it.take(160) }, Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 10.dp)
      .focusRequester(searchFocus).testTag("capability-search"),
      placeholder = { Text(if (skills) stringResource(R.string.capability_search_installed_skills)
        else stringResource(R.string.capability_search, stringResource(category.title))) },
      shape = CircleShape, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      keyboardActions = KeyboardActions(onSearch = { focus.clearFocus(); keyboard?.hide() }),
      colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
        focusedContainerColor = colors.surfaceContainer, unfocusedContainerColor = colors.surfaceContainer),
      leadingIcon = { ActionIcon(R.drawable.action_search) }, trailingIcon = {
        if (query.isNotEmpty()) IconButton(onClick = { query = "" }, modifier = Modifier.testTag("capability-search-clear")) {
          ActionIcon(R.drawable.action_close, contentDescription = stringResource(R.string.capability_clear))
        }
      })
  }
  detail?.let { row ->
    val chat = if (category == CapabilityCategory.Agents && row.group != "disabled") {
      { detail = null; onOpenAgent(row) }
    } else null
    ModalBottomSheet(onDismissRequest = { detail = null }, containerColor = colors.surface) {
      CapabilitySettingsPanel(row.name, row.description, origin, icon = {
        CapabilityItemIcon(row, category, origin, personal, agentAvatars, 44.dp)
      }, request = { body ->
        onPanel(category.key, if (category == CapabilityCategory.Connections) row.id else row.targetId ?: row.id, body)
      }, onChanged = { retry++ }, onChat = chat, onClose = { detail = null })
    }
  }
}

@Composable
private fun CapabilityItemIcon(item: CapabilityItem, category: CapabilityCategory, origin: String?,
  personal: PersonalUiState, avatars: Map<String, Bitmap>, extent: Dp = 48.dp) {
  when {
    item.personal -> PersonalAgentAvatar(personal.agentAvatar, personal.agent?.appearance.orEmpty(), extent, active = false)
    category == CapabilityCategory.Agents -> AgentAvatar(avatars[item.id], item.avatar.orEmpty(), item.id, extent, active = false)
    else -> CapabilityLogo(item.iconUrl, origin,
      if (item.id == "marketplace:search" || item.id == "mcp:setup") "" else item.name, category.icon, extent)
  }
}

@Composable
private fun capabilityLabel(zh: String, en: String) =
  if (LocalConfiguration.current.locales[0].language == "zh") zh else en

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ConversationMcpAction(conversationId: String, activeRun: Boolean,
  onPanel: suspend (String, String, JSONObject?) -> JSONObject) {
  val key = "conversation:$conversationId"
  val title = stringResource(R.string.capability_mcp_continue)
  var ready by remember(conversationId) { mutableStateOf(false) }
  var show by remember(conversationId) { mutableStateOf(false) }
  var revision by remember(conversationId) { mutableStateOf(0) }
  LaunchedEffect(conversationId, activeRun, revision) {
    if (activeRun) return@LaunchedEffect
    ready = try { onPanel("connections", key, null).optBoolean("available") }
    catch (error: CancellationException) { throw error }
    catch (_: Exception) { false }
  }
  if (ready) {
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    Box(Modifier.fillMaxWidth().padding(bottom = 6.dp), contentAlignment = Alignment.Center) {
      FilledTonalButton(onClick = { focus.clearFocus(); keyboard?.hide(); show = true },
        modifier = Modifier.testTag("chat-mcp-setup")) { Text(title) }
    }
  }
  if (show) {
    val close: () -> Unit = { show = false; revision++ }
    ModalBottomSheet(onDismissRequest = close) {
      CapabilitySettingsPanel(title, "", null, icon = {
        CapabilityLogo(null, null, "", R.drawable.action_capabilities, 44.dp)
      }, request = { body -> onPanel("connections", key, body) }, onChanged = {}, onChat = null, onClose = close)
    }
  }
}

private fun JSONObject.objects(key: String): List<JSONObject> = optJSONArray(key)?.let { array ->
  (0 until array.length()).map { array.getJSONObject(it) }
}.orEmpty()

private fun JSONObject.value(key: String): String? = (opt(key) as? String)?.takeIf(String::isNotBlank)

@Composable
private fun CapabilitySettingsPanel(name: String, summary: String, origin: String?, icon: @Composable () -> Unit,
  request: suspend (JSONObject?) -> JSONObject, onChanged: () -> Unit, onChat: (() -> Unit)?, onClose: () -> Unit) {
  val scope = rememberCoroutineScope()
  val browser = LocalUriHandler.current
  val keyboard = LocalSoftwareKeyboardController.current
  val requestFailure = capabilityLabel("暂时无法完成，请重试。", "Could not complete this action. Try again.")
  val waitingTooLong = capabilityLabel("等待时间过长，可以刷新状态或重新开始。", "This is taking longer than expected. Refresh or start again.")
  var panel by remember { mutableStateOf<JSONObject?>(null) }
  var values by remember { mutableStateOf(emptyMap<String, String>()) }
  var busy by remember { mutableStateOf(false) }
  var errorMessage by remember { mutableStateOf<String?>(null) }
  var advanced by remember { mutableStateOf(false) }
  var detailsOpen by remember { mutableStateOf(false) }
  var openWhenReady by remember { mutableStateOf(false) }
  var openedUrl by remember { mutableStateOf<String?>(null) }
  var confirm by remember { mutableStateOf<JSONObject?>(null) }

  fun authorizationUrl(value: JSONObject?): String? = value?.value("authorizationUrl")?.takeIf { raw ->
    val uri = Uri.parse(raw)
    uri.scheme == "https" && uri.host != null && uri.userInfo == null
  }

  suspend fun load(action: String? = null, polling: Boolean = false) {
    if (busy) return
    if (!polling) {
      busy = true
      errorMessage = null
      if (action?.startsWith("authorize") == true || action?.startsWith("status:") == true || action?.startsWith("status-server:") == true) {
        openWhenReady = true
        openedUrl = null
      }
    }
    val previous = values
    val priorPoll = panel?.value("pollAction")
    try {
      val result = request(action?.let {
        JSONObject().put("action", it).put("values", if (polling) JSONObject() else JSONObject(values)).apply {
          panel?.value("flow")?.let { flow -> put("flow", flow) }
          panel?.opt("revision")?.let { revision -> put("revision", revision) }
        }
      })
      if (polling && (busy || panel?.value("pollAction") != action)) return
      panel = result
      values = result.objects("fields").associate { field ->
        val id = field.getString("id")
        id to ((if (polling) previous[id] else null) ?: if (field.value("type") == "secret") "" else field.optString("value", ""))
      }
      errorMessage = null
      val url = authorizationUrl(result)
      if (openWhenReady && url != null && url != openedUrl) {
        openedUrl = url
        openWhenReady = false
        runCatching { browser.openUri(url) }.onFailure { errorMessage = requestFailure }
      }
      if ((!polling && action != null && action != "search") || (polling && priorPoll != null && result.value("pollAction") == null)) onChanged()
    } catch (cancelled: CancellationException) { throw cancelled }
    catch (error: Exception) {
      if (!polling) errorMessage = (error as? GatewayHttpException)?.detail ?: requestFailure
    }
    finally { if (!polling) busy = false }
  }

  LaunchedEffect(Unit) { load() }
  val pollAction = panel?.value("pollAction")
  LaunchedEffect(pollAction) {
    val action = pollAction ?: return@LaunchedEffect
    repeat(75) {
      delay(4000)
      if (panel?.value("pollAction") != action) return@LaunchedEffect
      load(action, polling = true)
    }
    if (panel?.value("pollAction") == action) errorMessage = waitingTooLong
  }
  fun perform(action: JSONObject) {
    keyboard?.hide()
    if (action.value("confirmation") != null && !action.optBoolean("inlineReview")) confirm = action
    else scope.launch { load(action.getString("id")) }
  }
  val allFields = panel?.objects("fields").orEmpty().filter { field ->
    val condition = field.optJSONObject("visibleWhen")
    condition == null || values[condition.getString("field")] == condition.getString("value")
  }
  val allActions = panel?.objects("actions").orEmpty()
  val hasAdvanced = allFields.any { it.optBoolean("advanced") } || allActions.any { it.optBoolean("advanced") }
  Column(Modifier.fillMaxWidth()) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
      icon()
      Text(name, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
      if (onChat != null) {
        IconButton(onClick = onChat, modifier = Modifier.size(44.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape)
          .testTag("capability-start-chat")) {
          ActionIcon(R.drawable.tab_conversations, contentDescription = stringResource(R.string.capability_start_chat))
        }
      }
      IconButton(onClick = onClose, modifier = Modifier.size(44.dp).background(MaterialTheme.colorScheme.surfaceContainer, CircleShape)
        .testTag("capability-panel-close")) {
        ActionIcon(R.drawable.action_close, contentDescription = stringResource(R.string.assistant_close))
      }
    }
    Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState())
      .padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
      verticalArrangement = Arrangement.spacedBy(18.dp)) {
      val status = panel?.value("message")
      if (status != null) Text(status, Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer,
        themedCorners(14)).padding(14.dp).testTag("capability-panel-status"), color = MaterialTheme.colorScheme.onSurfaceVariant)
      else if (summary.isNotEmpty()) Text(summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (busy) BrandLoadingIndicator(extent = 24.dp)
      errorMessage?.let {
        Text(it, color = MaterialTheme.colorScheme.error)
        if (panel == null) TextButton(onClick = { scope.launch { load() } }, enabled = !busy) {
          Text(capabilityLabel("重试", "Retry"))
        }
        if (pollAction != null) TextButton(onClick = { scope.launch { load(pollAction) } }, enabled = !busy) {
          Text(capabilityLabel("刷新状态", "Refresh status"))
        }
      }
      panel?.value("qrUrl")?.let { value ->
        val qr = remember(value) { runCatching { shareQrBitmap(value) }.getOrNull() }
        if (qr != null) Image(qr.asImageBitmap(), capabilityLabel("通道配对二维码", "Channel pairing QR code"),
          Modifier.align(Alignment.CenterHorizontally).background(androidx.compose.ui.graphics.Color.White, themedCorners(16))
            .padding(12.dp).size(176.dp))
      }
      authorizationUrl(panel)?.let { raw ->
        TextButton(onClick = { try { browser.openUri(raw) } catch (_: RuntimeException) { errorMessage = requestFailure } }, enabled = !busy) {
          Text(capabilityLabel("继续授权", "Continue sign-in"))
        }
      }
      panel?.value("details")?.let { details ->
        TextButton(onClick = { detailsOpen = !detailsOpen }, modifier = Modifier.testTag("capability-panel-review-details")) {
          Text(if (detailsOpen) capabilityLabel("收起详情", "Hide details") else capabilityLabel("查看详情", "View details"))
        }
        if (detailsOpen) Text(details, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
      }
      for (field in allFields.filter { !it.optBoolean("advanced") }) {
        CapabilityInput(field, values, busy, { id, text -> values = values + (id to text) },
          onSearch = { keyboard?.hide(); scope.launch { load("search") } })
      }
      allActions.filter { !it.optBoolean("advanced") }.forEachIndexed { index, action ->
        CapabilityActionButton(action, index == 0 && pollAction == null, busy) { perform(action) }
      }
      for (result in panel?.objects("results").orEmpty()) {
        Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(14)).padding(12.dp),
          verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          CapabilityLogo(result.value("iconUrl"), origin, result.optString("name"), R.drawable.action_task_list, 40.dp)
          Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(result.optString("name"), style = MaterialTheme.typography.titleSmall)
            result.value("summary")?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            Text(result.optString("source"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          val action = result.optJSONObject("action")
          if (action != null) TextButton(onClick = { perform(action) }, enabled = !busy,
            modifier = Modifier.testTag("capability-panel-" + action.optString("id"))) { Text(action.optString("label")) }
          else Text(capabilityLabel("已安装", "Installed"), style = MaterialTheme.typography.labelSmall)
        }
      }
      if (hasAdvanced) {
        TextButton(onClick = { advanced = !advanced }, modifier = Modifier.testTag("capability-panel-more")) {
          Text(if (advanced) capabilityLabel("收起选项", "Fewer options") else capabilityLabel("更多选项", "More options"))
        }
        if (advanced) {
          for (field in allFields.filter { it.optBoolean("advanced") }) {
            CapabilityInput(field, values, busy, { id, text -> values = values + (id to text) })
          }
          for (action in allActions.filter { it.optBoolean("advanced") }) {
            CapabilityActionButton(action, false, busy) { perform(action) }
          }
        }
      }
    }
  }
  confirm?.let { action ->
    AlertDialog(onDismissRequest = { confirm = null },
      title = { Text(action.getString("label")) }, text = { Text(action.optString("confirmation")) },
      confirmButton = { TextButton(onClick = { confirm = null; scope.launch { load(action.getString("id")) } }) {
        Text(capabilityLabel("确认", "Confirm"))
      } }, dismissButton = { TextButton(onClick = { confirm = null }) { Text(capabilityLabel("取消", "Cancel")) } })
  }
}

@Composable
private fun CapabilityActionButton(action: JSONObject, primary: Boolean, busy: Boolean, onClick: () -> Unit) {
  val modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag("capability-panel-" + action.getString("id"))
  if (primary) Button(onClick = onClick, modifier = modifier, enabled = !busy) { Text(action.getString("label")) }
  else TextButton(onClick = onClick, modifier = modifier, enabled = !busy) { Text(action.getString("label")) }
}

@Composable
private fun CapabilityInput(field: JSONObject, values: Map<String, String>, busy: Boolean,
  onChange: (String, String) -> Unit, onSearch: () -> Unit = {}) {
      val id = field.getString("id")
      val label = field.getString("label")
      val value = values[id].orEmpty()
      val change: (String) -> Unit = { onChange(id, it) }
      when (field.getString("type")) {
        "list" -> {
          val groups = value.lineSequence().map(String::trim).filter(String::isNotEmpty).distinct().toList()
          var pending by remember(id, value) { mutableStateOf("") }
          val removeLabel = capabilityLabel("移除", "Remove")
          val addGroup = {
            val item = pending.trim()
            if (item.isNotEmpty() && item.none { it == ',' || it == '\n' || it == '\r' }) {
              if (item !in groups) change((groups + item).joinToString("\n"))
              pending = ""
            }
          }
          Column(Modifier.fillMaxWidth().testTag("capability-field-$id"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            for (group in groups) {
              Row(verticalAlignment = Alignment.CenterVertically) {
                Text(group, Modifier.weight(1f))
                TextButton(onClick = { change(groups.filterNot { it == group }.joinToString("\n")) }, enabled = !busy,
                  modifier = Modifier.semantics { contentDescription = "$removeLabel $group" }) {
                  Text(removeLabel)
                }
              }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
              TextField(pending, { pending = it.take(160) }, Modifier.weight(1f), singleLine = true, enabled = !busy,
                placeholder = { Text(field.optString("hint")) }, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { addGroup() }))
              TextButton(onClick = addGroup, enabled = !busy && pending.isNotBlank()) { Text(capabilityLabel("添加群聊", "Add group")) }
            }
          }
        }
        "toggle" -> Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(14))
          .padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(label, Modifier.weight(1f))
          Switch(checked = value == "true", onCheckedChange = { change(it.toString()) }, enabled = !busy,
            modifier = Modifier.semantics { contentDescription = label }.testTag("capability-field-$id"))
        }
        "select" -> {
          val options = field.objects("options")
          var open by remember(id) { mutableStateOf(false) }
          Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(14)).padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            Box {
              TextButton(onClick = { open = true }, enabled = !busy,
                modifier = Modifier.testTag("capability-field-$id")) {
                Text(options.firstOrNull { it.value("id") == value }?.optString("label") ?: label)
              }
              DropdownMenu(open, onDismissRequest = { open = false }) {
                options.forEach { option ->
                  DropdownMenuItem(text = { Text(option.optString("label")) },
                    onClick = { change(option.getString("id")); open = false })
                }
              }
            }
          }
        }
        else -> TextField(value, change,
          Modifier.fillMaxWidth().testTag("capability-field-$id"), enabled = !busy,
          label = { Text(label) }, placeholder = field.value("hint")?.let { hint -> { Text(hint) } },
          shape = themedCorners(14),
          colors = TextFieldDefaults.colors(focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
            unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
            disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent),
          keyboardOptions = KeyboardOptions(imeAction = if (id == "query") ImeAction.Search else ImeAction.Default),
          keyboardActions = KeyboardActions(onSearch = { onSearch() }),
          singleLine = field.value("type") != "multiline",
          visualTransformation = if (field.value("type") == "secret") PasswordVisualTransformation()
            else VisualTransformation.None)
      }
}
