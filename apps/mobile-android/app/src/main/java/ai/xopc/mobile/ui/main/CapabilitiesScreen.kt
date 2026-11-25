package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.CapabilityItem
import ai.xopc.mobile.gateway.CapabilityPage
import ai.xopc.mobile.gateway.ConversationAgent
import ai.xopc.mobile.gateway.GatewayHttpException
import android.Manifest
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PersistableBundle
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerDefaults
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONArray
import androidx.compose.foundation.Image
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import kotlinx.coroutines.launch

private enum class CapabilityCategory(val key: String, val title: Int, val icon: Int) {
  Plugins("plugins", R.string.capability_plugins, R.drawable.action_capabilities),
  Skills("skills", R.string.capability_skills, R.drawable.action_task_list),
  Connections("connections", R.string.capability_connections, R.drawable.action_phone),
  Devices("devices", R.string.capability_devices, R.drawable.action_phone),
  Agents("agents", R.string.capability_agents, R.drawable.tab_assistant),
  Channels("channels", R.string.capability_channels, R.drawable.tab_conversations),
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
  onPanel: suspend (String, String, JSONObject?) -> JSONObject,
  onLoadDevices: suspend () -> ai.xopc.mobile.gateway.DeviceConnections = { ai.xopc.mobile.gateway.DeviceConnections(null, emptyList()) },
  onSetDeviceCapability: suspend (String, Boolean, String) -> Unit = { _, _, _ -> },
  onUseComputer: suspend (String) -> Unit = {},
  onShareDeviceFile: suspend (android.net.Uri) -> Unit = {},
  onPairDevice: () -> Unit = {},
  deviceScope: String? = null,
) {
  val navigation = rememberNavigationPreferences()
  val initialCategory = remember(navigation) {
    val key = navigation.selection("capabilities", CapabilityCategory.entries.map { it.key }, CapabilityCategory.Plugins.key)
    CapabilityCategory.entries.first { it.key == key }
  }
  val categories = CapabilityCategory.entries
  val pager = rememberPagerState(initialPage = initialCategory.ordinal) { categories.size }
  val category = categories[pager.settledPage]
  val scope = rememberCoroutineScope()
  val currentLoad by rememberUpdatedState(onLoad)
  val pages = remember(deviceScope) { mutableStateMapOf<CapabilityCategory, CapabilityPage>() }
  val loading = remember(deviceScope) { mutableStateMapOf<CapabilityCategory, Boolean>() }
  val failures = remember(deviceScope) { mutableStateMapOf<CapabilityCategory, Boolean>() }
  val queries = remember(deviceScope) { mutableStateMapOf<CapabilityCategory, String>() }
  val loadJobs = remember(deviceScope) { mutableMapOf<CapabilityCategory, kotlinx.coroutines.Job>() }
  val lists = remember(deviceScope) { categories.associateWith { LazyListState() } }
  var detail by remember(deviceScope) { mutableStateOf<CapabilityItem?>(null) }
  val keyboard = LocalSoftwareKeyboardController.current
  val focus = LocalFocusManager.current
  val searchFocus = remember { FocusRequester() }
  val colors = MaterialTheme.colorScheme
  val page = pages[category]
  val origin = page?.origin
  val query = queries[category].orEmpty()
  val skills = category == CapabilityCategory.Skills
  val agents = category == CapabilityCategory.Agents
  val connections = category == CapabilityCategory.Connections
  val plugins = category == CapabilityCategory.Plugins
  val skillMarketTitle = stringResource(R.string.capability_skill_market)
  val contactsToolPrompt = stringResource(R.string.device_tool_contacts_prompt)
  val calendarToolPrompt = stringResource(R.string.device_tool_calendar_prompt)
  val locationToolPrompt = stringResource(R.string.device_tool_location_prompt)

  fun load(requested: CapabilityCategory, refresh: Boolean = false) {
    if (requested == CapabilityCategory.Devices) return
    if (!refresh && (loading[requested] == true || pages.containsKey(requested) || failures[requested] == true)) return
    loadJobs.remove(requested)?.cancel()
    loading[requested] = true
    failures.remove(requested)
    val job = scope.launch {
      try {
        pages[requested] = currentLoad(requested.key)
      } catch (error: CancellationException) {
        throw error
      } catch (_: Exception) {
        failures[requested] = true
      } finally {
        if (loadJobs[requested] === coroutineContext[kotlinx.coroutines.Job]) {
          loadJobs.remove(requested)
          loading.remove(requested)
        }
      }
    }
    loadJobs[requested] = job
  }

  fun updateQuery(value: String) {
    if (queries[category].orEmpty() == value) return
    queries[category] = value
    lists.getValue(category).requestScrollToItem(0)
  }

  LaunchedEffect(pager, deviceScope) {
    var previous = pager.settledPage
    snapshotFlow { pager.settledPage }.collect { index ->
      if (index != previous) {
        focus.clearFocus()
        keyboard?.hide()
        navigation.rememberSelection("capabilities", categories[index].key)
        previous = index
      }
      load(categories[index])
      categories.getOrNull(index - 1)?.let { load(it) }
      categories.getOrNull(index + 1)?.let { load(it) }
    }
  }

  val motionAllowed = rememberMotionAllowed()
  Column(Modifier.fillMaxSize().background(colors.background).padding(insets).imePadding()) {
    XopcPageHeader(
      backTag = "capability-back",
      onBack = onExit,
      titleContent = {
        PageTitleMenu(
          categories.map { SegmentOption(it, stringResource(it.title), "capability-category-${it.key}") },
          category, "capability-page-menu",
        ) { target ->
          scope.launch {
            val distance = target.ordinal - pager.currentPage
            if (xopcPagerAnimated(motionAllowed, distance)) pager.animateScrollToPage(target.ordinal)
            else pager.scrollToPage(target.ordinal)
          }
        }
      },
    ) {
      if (skills) {
        IconButton(onClick = {
          focus.clearFocus()
          keyboard?.hide()
          detail = CapabilityItem("marketplace:search", skillMarketTitle, group = "available")
        }, modifier = Modifier.size(44.dp).background(colors.primaryContainer, CircleShape).testTag("capability-add-skills")) {
          ActionIcon(R.drawable.action_capabilities, color = colors.primary, contentDescription = skillMarketTitle)
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
        val prompt = stringResource(if (agents) R.string.capability_agent_setup_prompt else R.string.capability_skill_setup_prompt)
        IconButton(onClick = {
          focus.clearFocus()
          keyboard?.hide()
          if (connections) detail = CapabilityItem("mcp:setup", label, group = "available")
          else onSetupChat(prompt, agents)
        }, modifier = Modifier.size(44.dp).background(colors.primaryContainer, CircleShape)
          .testTag(if (connections) "capability-add-mcp" else "capability-chat-setup-${category.key}")) {
          ActionIcon(R.drawable.action_add, color = colors.primary, contentDescription = label)
        }
      }
    }
    Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = XopcDesignTokens.PagePaddingX)) {
    if (category != CapabilityCategory.Devices) {
      XopcPageSearchField(
        query = query,
        onQueryChange = { updateQuery(it) },
        placeholder = if (skills) stringResource(R.string.capability_search_installed_skills)
          else stringResource(R.string.capability_search, stringResource(category.title)),
        tag = "capability-search",
        autoFocus = false,
        focusRequester = searchFocus,
        modifier = Modifier.padding(top = 4.dp, bottom = 10.dp),
      )
    }
    HorizontalPager(pager, modifier = Modifier.weight(1f).fillMaxWidth().testTag("capability-pager"),
      key = { categories[it].key }, userScrollEnabled = detail == null,
      flingBehavior = PagerDefaults.flingBehavior(pager, snapPositionalThreshold = 0.33f),
    ) { index ->
      val kind = categories[index]
      Column(Modifier.fillMaxSize()) {
        if (kind == CapabilityCategory.Devices) {
          androidx.compose.runtime.key(deviceScope) {
            DeviceConnectionsScreen(onLoadDevices, onUseComputer, onShareDeviceFile, { tool ->
              val prompt = when (tool) {
                "mobile.contacts.pick" -> contactsToolPrompt
                "mobile.calendar.query_events" -> calendarToolPrompt
                else -> locationToolPrompt
              }
              onSetupChat(prompt, false)
            }, onPairDevice, setCapability = onSetDeviceCapability, active = category == CapabilityCategory.Devices)
          }
        } else {
          val catalog = pages[kind]
          val failed = failures[kind] == true
          val pending = loading[kind] == true || (catalog == null && !failed)
          val groups = capabilityRows(kind, catalog, personal, queries[kind].orEmpty())
          val search = queries[kind].orEmpty().trim()
          val list = lists.getValue(kind)
          XopcPullToRefreshBox(
            isRefreshing = loading[kind] == true && catalog != null,
            onRefresh = { load(kind, refresh = true) },
            modifier = Modifier.fillMaxSize(),
          ) {
          LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 4.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (pending && catalog == null) item { CapabilityListSkeleton() }
            if (failed || catalog?.incomplete == true) item {
              XopcInlineBanner(
                message = stringResource(if (failed) R.string.capability_load_failed else R.string.capability_partial),
                tone = if (failed) XopcBannerTone.Danger else XopcBannerTone.Warning,
                actionLabel = stringResource(R.string.capability_retry),
                onAction = { load(kind, refresh = true) },
              )
            }
            if (!pending && !failed && groups.isEmpty()) item {
              XopcEmptyState(
                message = stringResource(if (search.isEmpty()) R.string.capability_empty else R.string.capability_no_matches),
                icon = R.drawable.action_search,
                actionLabel = if (search.isNotEmpty()) stringResource(R.string.capability_clear) else null,
                onAction = if (search.isNotEmpty()) ({ if (pager.settledPage == index) updateQuery("") }) else null,
                modifier = Modifier.padding(top = 24.dp).testTag("capability-empty"),
              )
            }
            capabilityGroups.forEach { group ->
              val rows = groups[group] ?: return@forEach
              item("group-$group") {
                Text(stringResource(capabilityGroup(group)), style = MaterialTheme.typography.labelLarge,
                  color = colors.onSurfaceVariant, modifier = Modifier.padding(top = 14.dp, bottom = 2.dp, start = 4.dp))
              }
              items(rows, key = { it.id }) { row ->
                val isAgent = kind == CapabilityCategory.Agents
                val canOpenRow = !isAgent || row.group != "disabled"
                CapabilityCard(row.name, row.description, modifier = Modifier.testTag("capability-row-${row.id}"),
                  onClick = if (canOpenRow) ({
                    if (pager.settledPage == index && !pager.isScrollInProgress) {
                      focus.clearFocus(); keyboard?.hide()
                      if (isAgent) onOpenAgent(row) else detail = row
                    }
                  }) else null, leading = { CapabilityItemIcon(row, kind, catalog?.origin, personal, agentAvatars) }) {
                  if (isAgent) {
                    val settingsLabel = "${stringResource(R.string.settings_title)} · ${row.name}"
                    IconButton(onClick = {
                      if (pager.settledPage == index && !pager.isScrollInProgress) {
                        focus.clearFocus(); keyboard?.hide(); detail = row
                      }
                    }, modifier = Modifier.size(44.dp).testTag("capability-settings-${row.id}")) {
                      ActionIcon(R.drawable.action_more_horizontal, color = colors.onSurfaceVariant,
                        contentDescription = settingsLabel, size = 18.dp)
                    }
                  } else if (kind == CapabilityCategory.Connections && (row.group == "available" || row.group == "attention")) {
                    Text(stringResource(R.string.capability_connect), style = MaterialTheme.typography.labelLarge, color = colors.primary)
                  } else {
                    ActionIcon(R.drawable.action_chevron_right, color = colors.onSurfaceVariant, size = 14.dp)
                  }
                }
              }
            }
          }
          }
        }
      }
    }
    }
  }
  detail?.let { row ->
    val chat = if (category == CapabilityCategory.Agents && row.group != "disabled") {
      { detail = null; onOpenAgent(row) }
    } else null
    XopcBottomSheet(XopcSheetPreset.Large, onDismissRequest = { detail = null }, containerColor = colors.surface) {
      CapabilitySettingsPanel(row.name, row.description, origin, icon = {
        CapabilityItemIcon(row, category, origin, personal, agentAvatars, 44.dp)
      }, request = { body ->
        onPanel(category.key, if (category == CapabilityCategory.Connections) row.id else row.targetId ?: row.id, body)
      }, onChanged = { load(category, refresh = true) }, onChat = chat, onClose = { detail = null },
        onUseInChat = { prompt -> detail = null; onSetupChat(prompt, false) },
        isMcpSetup = row.id == "mcp:setup")
    }
  }
}

@Composable
internal fun CapabilityListSkeleton() {
  XopcListSkeleton(modifier = Modifier.testTag("capability-loading"), rows = 3)
}

@Composable
internal fun CapabilityCard(
  title: String, description: String, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null,
  leading: @Composable () -> Unit, trailing: (@Composable () -> Unit)? = null,
) {
  val colors = MaterialTheme.colorScheme
  val press = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier
  Row(modifier.fillMaxWidth().heightIn(min = 76.dp).clip(themedCorners(18)).background(colors.surface)
    .then(press).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(14.dp)) {
    leading()
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (description.isNotBlank()) Text(description, style = MaterialTheme.typography.bodySmall,
        color = colors.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    trailing?.invoke()
  }
}

@Composable
private fun capabilityRows(kind: CapabilityCategory, page: CapabilityPage?, personal: PersonalUiState, query: String):
  Map<String, List<CapabilityItem>> {
  val agent = personal.agent?.takeIf { it.state == "ready" && kind == CapabilityCategory.Agents }
  val rows = page?.items.orEmpty().filterNot { it.id == agent?.agentId }.map { item ->
    if (kind != CapabilityCategory.Agents) item
    else {
      val profile = ConversationAgent(item.id, item.name, item.description)
      item.copy(name = agentDisplayName(profile), description = agentDisplayDescription(profile))
    }
  }
  val entries = if (agent == null) rows else listOf(CapabilityItem(
    agent.agentId, agent.displayName, stringResource(R.string.capability_personal_description), "assistant", personal = true,
  )) + rows
  val search = query.trim()
  return entries.filter { row ->
    search.isEmpty() || listOf(row.name, row.id, row.description).any { it.contains(search, ignoreCase = true) }
  }.groupBy { it.group }
}

@Composable
private fun CapabilityItemIcon(item: CapabilityItem, category: CapabilityCategory, origin: String?,
  personal: PersonalUiState, avatars: Map<String, Bitmap>, extent: Dp = 48.dp) {
  when {
    item.personal -> PersonalAgentAvatar(personal.agentAvatar, personal.agent?.appearance.orEmpty(), extent, active = false)
    category == CapabilityCategory.Agents -> AgentAvatar(avatars[item.id], item.avatar.orEmpty(), item.id, extent, active = false)
    item.id == "mcp:setup" -> CapabilityLogo(null, origin, "", R.drawable.action_link, extent)
    else -> CapabilityLogo(item.iconUrl, origin,
      if (item.id == "marketplace:search") "" else item.name, category.icon, extent)
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
    XopcBottomSheet(XopcSheetPreset.Large, onDismissRequest = close, containerColor = MaterialTheme.colorScheme.surface) {
      CapabilitySettingsPanel(title, "", null, icon = {
        CapabilityLogo(null, null, "", R.drawable.action_capabilities, 44.dp)
      }, request = { body -> onPanel("connections", key, body) }, onChanged = {}, onChat = null, onClose = close,
        onUseInChat = { close() }, isConversation = true)
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LinkedMcpSetupSheet(name: String, serverUrl: String, origin: String?,
  request: suspend (JSONObject?) -> JSONObject, onClose: () -> Unit, onUseInChat: (String) -> Unit) {
  XopcBottomSheet(XopcSheetPreset.Large, onDismissRequest = onClose, containerColor = MaterialTheme.colorScheme.surface) {
    CapabilitySettingsPanel(stringResource(R.string.capability_add_mcp), "", origin,
      icon = { CapabilityLogo(null, origin, "", R.drawable.action_link, 44.dp) },
      request = request, onChanged = {}, onChat = null, onClose = onClose, onUseInChat = onUseInChat,
      isMcpSetup = true, initialFields = mapOf("id" to name, "url" to serverUrl))
  }
}

private fun JSONObject.objects(key: String): List<JSONObject> = optJSONArray(key)?.let { array ->
  (0 until array.length()).map { array.getJSONObject(it) }
}.orEmpty()

private fun JSONObject.value(key: String): String? = (opt(key) as? String)?.takeIf(String::isNotBlank)

private fun JSONObject.strings(key: String): List<String> = optJSONArray(key)?.let { array ->
  (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }
}.orEmpty()

private fun safeHttpsUrl(raw: String?): String? = raw?.takeIf { value ->
  val uri = Uri.parse(value)
  uri.scheme == "https" && uri.host != null && uri.userInfo == null
}

@Composable
private fun CapabilitySettingsPanel(name: String, summary: String, origin: String?, icon: @Composable () -> Unit,
  request: suspend (JSONObject?) -> JSONObject, onChanged: () -> Unit, onChat: (() -> Unit)?, onClose: () -> Unit,
  onUseInChat: ((String) -> Unit)? = null, isMcpSetup: Boolean = false, isConversation: Boolean = false,
  initialFields: Map<String, String> = emptyMap()) {
  val scope = rememberCoroutineScope()
  val browser = LocalUriHandler.current
  val keyboard = LocalSoftwareKeyboardController.current
  val focus = LocalFocusManager.current
  val requestFailure = capabilityLabel("暂时无法完成，请重试。", "Could not complete this action. Try again.")
  val waitingTooLong = capabilityLabel("等待时间过长，可以刷新状态或重新开始。", "This is taking longer than expected. Refresh or start again.")
  var panel by remember { mutableStateOf<JSONObject?>(null) }
  var values by remember { mutableStateOf(emptyMap<String, String>()) }
  var retainedValues by remember { mutableStateOf(emptyMap<String, String>()) }
  var requestRevision by remember { mutableStateOf(0) }
  var busy by remember { mutableStateOf(false) }
  var errorMessage by remember { mutableStateOf<String?>(null) }
  var advanced by remember { mutableStateOf(false) }
  var detailsOpen by remember { mutableStateOf(false) }
  var openWhenReady by remember { mutableStateOf(false) }
  var openedUrl by remember { mutableStateOf<String?>(null) }
  var pollingNow by remember { mutableStateOf(false) }
  var confirm by remember { mutableStateOf<JSONObject?>(null) }

  fun authorizationUrl(value: JSONObject?): String? = value?.value("authorizationUrl")?.takeIf { raw ->
    val uri = Uri.parse(raw)
    uri.scheme == "https" && uri.host != null && uri.userInfo == null
  }

  suspend fun load(action: String? = null, polling: Boolean = false) {
    if (busy || (polling && pollingNow)) return
    if (polling) pollingNow = true
    if (!polling) {
      busy = true
      errorMessage = null
      if (action?.startsWith("authorize") == true || action?.startsWith("status:") == true || action?.startsWith("status-server:") == true) {
        openWhenReady = true
        openedUrl = null
      }
    }
    val previous = values
    val revision = ++requestRevision
    val submitted = if (isMcpSetup) {
      panel?.objects("fields").orEmpty().filter { capabilityItemVisible(it, values) }
        .associate { it.getString("id") to values[it.getString("id")].orEmpty() }
    } else values
    val priorPoll = panel?.value("pollAction")
    val priorFlow = panel?.value("flow")
    try {
      val result = request(action?.let {
        JSONObject().put("action", it).put("values", if (polling) JSONObject() else JSONObject(submitted)).apply {
          panel?.value("flow")?.let { flow -> put("flow", flow) }
          panel?.opt("revision")?.let { revision -> put("revision", revision) }
        }
      })
      if (revision != requestRevision || polling && (busy || panel?.value("pollAction") != action || panel?.value("flow") != priorFlow)) return
      val prefill = if (panel == null && action == null) initialFields else emptyMap()
      panel = result
      val resultActions = result.objects("actions")
      if (resultActions.any { it.optBoolean("dismiss") } && resultActions.none { it.value("id") == "add-another" }) {
        retainedValues = emptyMap()
      }
      values = result.objects("fields").associate { field ->
        val id = field.getString("id")
        id to ((if (polling) previous[id] else null)
          ?: (if (field.optBoolean("retain")) retainedValues[id] else null)
          ?: prefill[id]
          ?: if (field.value("type") == "secret") "" else field.optString("value", ""))
      }
      errorMessage = null
      val url = authorizationUrl(result)
      if (openWhenReady && url != null && url != openedUrl) {
        openedUrl = url
        openWhenReady = false
        runCatching { browser.openUri(url) }.onFailure { errorMessage = requestFailure }
      }
      if (isMcpSetup) {
        if (action == "save" && resultActions.any { it.optBoolean("dismiss") }) onChanged()
      } else if ((!polling && action != null && action != "search") ||
        (polling && priorPoll != null && result.value("pollAction") == null)) onChanged()
    } catch (cancelled: CancellationException) { throw cancelled }
    catch (error: Exception) {
      if (!polling) errorMessage = (error as? GatewayHttpException)?.detail ?: requestFailure
    }
    finally { if (polling) pollingNow = false else busy = false }
  }

  LaunchedEffect(Unit) { load() }
  val pollAction = panel?.value("pollAction")
  val flow = panel?.value("flow")
  LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
    panel?.value("pollAction")?.let { action -> scope.launch { load(action, polling = true) } }
  }
  LaunchedEffect(pollAction, flow) {
    val action = pollAction ?: return@LaunchedEffect
    repeat(75) {
      delay(4000)
      if (panel?.value("pollAction") != action) return@LaunchedEffect
      load(action, polling = true)
    }
    if (panel?.value("pollAction") == action) errorMessage = waitingTooLong
  }
  fun perform(action: JSONObject) {
    if (busy) return
    focus.clearFocus()
    keyboard?.hide()
    if (action.optBoolean("dismiss")) onClose()
    else if (action.value("confirmation") != null && !action.optBoolean("inlineReview")) confirm = action
    else scope.launch { load(action.getString("id")) }
  }
  fun updateField(field: JSONObject, id: String, value: String) {
    values = values + (id to value)
    if (field.optBoolean("retain")) retainedValues = retainedValues + (id to value)
    if (field.value("presentation") == "segmented") {
      focus.clearFocus()
      keyboard?.hide()
      errorMessage = null
    }
  }
  val allFields = panel?.objects("fields").orEmpty().filter { capabilityItemVisible(it, values) }
  val allActions = panel?.objects("actions").orEmpty().filter { capabilityItemVisible(it, values) }
  val mainActions = allActions.filter { !it.optBoolean("advanced") }
  val hasAdvanced = allFields.any { it.optBoolean("advanced") } || allActions.any { it.optBoolean("advanced") }
  val authUrl = authorizationUrl(panel)
  val qrValue = panel?.value("qrUrl")
  var showQr by remember(authUrl) { mutableStateOf(false) }
  val qrOnly = if (authUrl == null) qrValue else null
  val visibleFields = allFields.filter { advanced || !it.optBoolean("advanced") }
  val results = panel?.objects("results").orEmpty()
  val steps = panel?.strings("steps").orEmpty()
  val visibleLinks = panel?.objects("links").orEmpty().filter { link ->
    capabilityItemVisible(link, values) && safeHttpsUrl(link.value("url")) != null && link.value("label") != null
  }
  val visibleCopyable = panel?.optJSONObject("copyable")?.takeIf { block ->
    capabilityItemVisible(block, values) && block.value("content") != null
  }
  val readyPrompt = panel?.value("chatPrompt")?.takeIf {
    pollAction == null && errorMessage == null && onUseInChat != null &&
      panel?.objects("fields").orEmpty().none { field ->
        val id = field.getString("id")
        val initial = if (field.value("type") == "secret") "" else field.optString("value", "")
        values[id].orEmpty() != initial
      }
  }
  val expanded = (qrValue != null && (qrOnly != null || showQr)) ||
    panel?.value("reviewText") != null ||
    steps.isNotEmpty() || visibleLinks.isNotEmpty() || visibleCopyable != null ||
    (hasAdvanced && advanced) || (detailsOpen && panel?.value("details") != null) ||
    visibleFields.size >= 3 || visibleFields.any { it.value("type") in setOf("multiline", "list", "headers") } || results.size >= 3
  val drawerHeight = if (expanded) Modifier.fillMaxHeight(.82f)
    else Modifier.heightIn(max = if (isMcpSetup) 460.dp else 420.dp).fillMaxHeight()
  val expiresAt = panel?.optLong("expiresAt") ?: 0L
  val primary = mainActions.firstOrNull()?.takeIf { readyPrompt == null && authUrl == null && qrOnly == null && pollAction == null }
  val cancel = mainActions.find { it.value("id") == "pair-cancel" }
  val colors = MaterialTheme.colorScheme
  Column(Modifier.fillMaxWidth().then(drawerHeight)) {
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
    Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())
      .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 16.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp)) {
      val headline = panel?.value("headline")
      val subtitle = panel?.value("subtitle")
      if (headline != null || subtitle != null) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
          headline?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
          subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant) }
        }
      }
      val status = panel?.value("message")
      if (status != null || readyPrompt != null) Row(Modifier.fillMaxWidth().background(colors.surfaceContainerLow, themedCorners(16))
        .padding(horizontal = 14.dp, vertical = 12.dp).testTag("capability-panel-status"),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        if (panel?.value("tone") == "success" || readyPrompt != null) {
          ActionIcon(
            R.drawable.action_check_circle,
            color = ai.xopc.mobile.theme.LocalStatusColors.current.success,
            contentDescription = null,
            size = 18.dp,
          )
        } else if (pollAction != null) {
          Box(Modifier.size(8.dp).background(colors.primary, CircleShape))
        }
        Text(status ?: capabilityLabel("可在对话中使用", "Ready to use in chat"),
          style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant)
      }
      else if (summary.isNotEmpty()) Text(summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (steps.isNotEmpty()) CapabilityPanelSteps(steps)
      visibleCopyable?.let { CapabilityCopyableCard(it, busy) }
      if (visibleLinks.isNotEmpty()) CapabilityPanelLinks(visibleLinks, busy) { url ->
        runCatching { browser.openUri(url) }.onFailure { errorMessage = requestFailure }
      }
      panel?.value("reviewText")?.let { review ->
        Text(review, Modifier.fillMaxWidth().background(colors.surfaceContainerLow, themedCorners(16))
          .padding(14.dp).testTag("capability-panel-review-text"),
          style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
      }
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
      CapabilitySetupOptions(authUrl, panel?.value("deviceVerificationCode"), qrValue, expiresAt, busy,
        showQr, onToggleQr = { showQr = !showQr })
      if (!isMcpSetup) CapabilityPanelDetails(panel, detailsOpen) { detailsOpen = !detailsOpen }
      for (field in allFields.filter { !it.optBoolean("advanced") }) {
        CapabilityInput(field, values, busy, { id, text -> updateField(field, id, text) },
          onSearch = { keyboard?.hide(); scope.launch { load("search") } })
      }
      if (isMcpSetup) {
        panel?.value("details")?.let { details ->
          CapabilityDisclosure(
            label = panel?.value("detailsLabel") ?: capabilityLabel("查看详情", "View details"),
            expanded = detailsOpen,
            testTag = "capability-panel-review-details",
            enabled = !busy,
            onToggle = { detailsOpen = !detailsOpen },
          ) {
            Text(details, color = colors.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
          }
        }
      }
      for (action in mainActions.filter { it != primary && it != cancel }) {
        CapabilityActionButton(action, false, busy) { perform(action) }
      }
      for (result in results) {
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
        val label = panel?.value("advancedLabel") ?: capabilityLabel("更多选项", "More options")
        val options: @Composable () -> Unit = {
          for (field in allFields.filter { it.optBoolean("advanced") }) {
            CapabilityInput(field, values, busy, { id, text -> updateField(field, id, text) })
          }
          for (action in allActions.filter { it.optBoolean("advanced") }) {
            CapabilityActionButton(action, false, busy) { perform(action) }
          }
        }
        if (isMcpSetup) {
          CapabilityDisclosure(label, advanced, "capability-panel-more", !busy, { advanced = !advanced }, options)
        } else {
          TextButton(onClick = { advanced = !advanced }, modifier = Modifier.testTag("capability-panel-more")) {
            Text(if (advanced) capabilityLabel("收起选项", "Fewer options") else label)
          }
          if (advanced) options()
        }
      }
    }
    if (readyPrompt != null || authUrl != null || qrOnly != null || primary != null || cancel != null) {
      HorizontalDivider(color = colors.outlineVariant.copy(alpha = .5f))
      Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 8.dp)) {
        when {
          readyPrompt != null -> Button(onClick = {
            focus.clearFocus()
            keyboard?.hide()
            onUseInChat?.invoke(readyPrompt)
          }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .testTag("capability-use-in-chat")) {
            Text(if (isConversation) capabilityLabel("返回对话", "Back to chat") else capabilityLabel("通过对话使用", "Use in chat"))
          }
          authUrl != null -> Button(onClick = {
            runCatching { browser.openUri(authUrl) }.onSuccess { openedUrl = authUrl }
              .onFailure { errorMessage = requestFailure }
          }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .testTag("capability-panel-open-authorization")) {
            Text(when {
              openedUrl == authUrl -> capabilityLabel("重新打开授权页", "Reopen authorization")
              panel?.value("deviceVerificationCode") != null -> capabilityLabel("打开验证页", "Open verification page")
              else -> capabilityLabel("前往授权", "Open authorization")
            })
          }
          qrOnly != null -> CapabilityQrSaveButton(qrOnly, expiresAt, busy, primary = true)
          primary != null -> CapabilityActionButton(primary, true, busy) { perform(primary) }
        }
        if (cancel != null && cancel != primary) CapabilityActionButton(cancel, false, busy) { perform(cancel) }
      }
    }
  }
  confirm?.let { action ->
    XopcConfirmDialog(
      onDismiss = { confirm = null },
      onConfirm = { confirm = null; scope.launch { load(action.getString("id")) } },
      title = action.getString("label"),
      message = action.optString("confirmation"),
      confirmLabel = capabilityLabel("确认", "Confirm"),
      cancelLabel = capabilityLabel("取消", "Cancel"),
      destructive = action.optBoolean("destructive", false),
    )
  }
}

@Composable
private fun CapabilityDisclosure(
  label: String,
  expanded: Boolean,
  testTag: String,
  enabled: Boolean,
  onToggle: () -> Unit,
  content: @Composable () -> Unit,
) {
  val colors = MaterialTheme.colorScheme
  Column(Modifier.fillMaxWidth().clip(themedCorners(14)).background(colors.surfaceContainerLow)) {
    Row(
      Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag(testTag)
        .clickable(enabled = enabled, role = Role.Button, onClick = onToggle)
        .padding(horizontal = 14.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
      ActionIcon(
        if (expanded) R.drawable.action_chevron_down else R.drawable.action_chevron_right,
        color = colors.onSurfaceVariant,
        contentDescription = null,
        size = 14.dp,
      )
    }
    if (expanded) {
      Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        content()
      }
    }
  }
}

@Composable
private fun CapabilityPanelDetails(panel: JSONObject?, open: Boolean, onToggle: () -> Unit) {
  val details = panel?.value("details") ?: return
  TextButton(onClick = onToggle, modifier = Modifier.testTag("capability-panel-review-details")) {
    Text(if (open) capabilityLabel("收起详情", "Hide details") else panel.value("detailsLabel") ?: capabilityLabel("查看详情", "View details"))
  }
  if (open) Text(details, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun CapabilitySetupOptions(authorizationUrl: String?, userCode: String?, qrValue: String?,
  expiresAt: Long, busy: Boolean, showQr: Boolean, onToggleQr: () -> Unit) {
  val context = LocalContext.current
  val colors = MaterialTheme.colorScheme
  val card = themedCorners(16)
  if (authorizationUrl != null && userCode != null) {
    Row(Modifier.fillMaxWidth().background(colors.surfaceContainerLow, card).border(1.dp, colors.outlineVariant, card)
      .padding(horizontal = 14.dp, vertical = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(capabilityLabel("验证码", "Verification code"), style = MaterialTheme.typography.labelMedium, color = colors.onSurfaceVariant)
        Text(userCode, style = MaterialTheme.typography.titleMedium, fontFamily = FontFamily.Monospace)
      }
      FilledTonalButton(onClick = {
        copySensitiveClip(context, userCode)
      }, enabled = !busy, modifier = Modifier.heightIn(min = 44.dp)) {
        ActionIcon(R.drawable.message_copy, contentDescription = null, size = 16.dp)
        Spacer(Modifier.size(6.dp))
        Text(capabilityLabel("复制", "Copy"))
      }
    }
  }
  if (authorizationUrl != null && qrValue != null) {
    TextButton(onClick = onToggleQr, enabled = !busy,
      modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).background(colors.surfaceContainerLow, card)
        .testTag("capability-panel-other-methods")) {
      Text(if (showQr) capabilityLabel("收起二维码", "Hide QR code") else capabilityLabel("其他方式", "Other ways"),
        Modifier.weight(1f))
      ActionIcon(R.drawable.action_chevron_down, contentDescription = null, size = 16.dp,
        modifier = Modifier.rotate(if (showQr) 180f else 0f))
    }
  }
  if (qrValue != null && (authorizationUrl == null || showQr)) {
    val qr = remember(qrValue) { runCatching { shareQrBitmap(qrValue, size = 512, margin = 4) }.getOrNull() }
    if (qr != null) Column(Modifier.fillMaxWidth().background(colors.surfaceContainerLow, card).padding(16.dp),
      horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Image(qr.asImageBitmap(), capabilityLabel("授权二维码", "Authorization QR code"),
        Modifier.size(188.dp).clip(themedCorners(16)).background(Color.White).padding(4.dp).testTag("capability-panel-qr"))
      Text(capabilityLabel("从扫一扫的相册入口选图，或用另一台设备扫码。",
        "Select the saved image if the scanner supports Photos, or scan with another device."),
        style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant, textAlign = TextAlign.Center)
      if (authorizationUrl != null) CapabilityQrSaveButton(qrValue, expiresAt, busy, primary = false)
    }
  }
}

@Composable
private fun CapabilityQrSaveButton(qrValue: String, expiresAt: Long, busy: Boolean, primary: Boolean) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var saving by remember(qrValue) { mutableStateOf(false) }
  var saveMessage by remember(qrValue) { mutableStateOf<Pair<Boolean, String>?>(null) }
  val expired = capabilityLabel("二维码已过期，请刷新状态。", "The QR code expired. Refresh its status.")
  val failure = capabilityLabel("未能保存二维码，请检查相册权限后重试。", "Could not save the QR code. Check photo access and try again.")
  val saved = capabilityLabel("已保存到相册。", "Saved to Photos.")
  fun save() {
    if (saving) return
    if (expiresAt > 0 && System.currentTimeMillis() >= expiresAt) {
      saveMessage = false to expired
      return
    }
    saving = true
    scope.launch {
      try {
        withContext(Dispatchers.IO) { saveCapabilityQr(context, shareQrBitmap(qrValue, size = 512, margin = 4)) }
        saveMessage = true to saved
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (_: Exception) {
        saveMessage = false to failure
      } finally {
        saving = false
      }
    }
  }
  val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) save() else saveMessage = false to failure
  }
  Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
    val saveLabel = if (saving) capabilityLabel("正在保存…", "Saving…") else capabilityLabel("保存二维码", "Save QR code")
    val modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("capability-panel-save-qr")
    val onSave = {
      if (Build.VERSION.SDK_INT < 29 && ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE)
        != PackageManager.PERMISSION_GRANTED) permission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
      else save()
    }
    if (primary) Button(onClick = onSave, enabled = !busy && !saving, modifier = modifier) { Text(saveLabel) }
    else TextButton(onClick = onSave, enabled = !busy && !saving, modifier = modifier) { Text(saveLabel) }
    saveMessage?.let { (success, message) ->
      Text(message, color = if (success) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
    }
  }
}

private fun saveCapabilityQr(context: Context, qr: Bitmap) {
  val resolver = context.contentResolver
  val values = ContentValues().apply {
    put(MediaStore.Images.Media.DISPLAY_NAME, "xopc-qr-${System.currentTimeMillis()}.png")
    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
    if (Build.VERSION.SDK_INT >= 29) {
      put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES)
      put(MediaStore.Images.Media.IS_PENDING, 1)
    }
  }
  val destination = checkNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
  try {
    checkNotNull(resolver.openOutputStream(destination)).use { check(qr.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    if (Build.VERSION.SDK_INT >= 29) {
      val complete = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
      check(resolver.update(destination, complete, null, null) == 1)
    }
  } catch (error: Exception) {
    runCatching { resolver.delete(destination, null, null) }
    throw error
  }
}

@Composable
private fun CapabilityActionButton(action: JSONObject, primary: Boolean, busy: Boolean, onClick: () -> Unit) {
  val modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag("capability-panel-" + action.getString("id"))
  if (primary) Button(onClick = onClick, modifier = modifier, enabled = !busy) { Text(action.getString("label")) }
  else TextButton(onClick = onClick, modifier = modifier, enabled = !busy) {
    Text(action.getString("label"),
      color = if (action.value("id") == "pair-cancel") MaterialTheme.colorScheme.onSurfaceVariant else Color.Unspecified)
  }
}

@Composable
private fun CapabilityPanelSteps(steps: List<String>) {
  val colors = MaterialTheme.colorScheme
  Column(Modifier.fillMaxWidth().background(colors.surfaceContainerLow, themedCorners(16))
    .padding(14.dp).testTag("capability-panel-steps"),
    verticalArrangement = Arrangement.spacedBy(8.dp)) {
    steps.forEachIndexed { index, step ->
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        if (steps.size > 1) {
          Text("${index + 1}.", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = colors.primary)
        }
        Text(step, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
      }
    }
  }
}

@Composable
private fun CapabilityCopyableCard(block: JSONObject, busy: Boolean) {
  val context = LocalContext.current
  val colors = MaterialTheme.colorScheme
  val label = block.value("label").orEmpty()
  val content = block.value("content").orEmpty()
  val note = block.value("note")
  var copied by remember(content) { mutableStateOf(false) }
  Column(Modifier.fillMaxWidth().background(colors.surfaceContainerLow, themedCorners(16))
    .padding(14.dp).testTag("capability-panel-copyable"),
    verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(label, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = colors.onSurface)
      FilledTonalButton(onClick = {
        copySensitiveClip(context, content)
        copied = true
      }, enabled = !busy, modifier = Modifier.heightIn(min = 38.dp).testTag("capability-panel-copy-block")) {
        ActionIcon(if (copied) R.drawable.action_check_circle else R.drawable.message_copy, contentDescription = null, size = 15.dp)
        Spacer(Modifier.size(6.dp))
        Text(if (copied) capabilityLabel("已复制", "Copied") else capabilityLabel("复制", "Copy"))
      }
    }
    Box(Modifier.fillMaxWidth().heightIn(max = 140.dp).background(colors.surfaceContainer, themedCorners(12))
      .verticalScroll(rememberScrollState()).padding(10.dp)) {
      Text(content, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = colors.onSurface)
    }
    if (note != null) {
      Text(note, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
    }
  }
}

private fun copySensitiveClip(context: Context, text: String) {
  val clip = ClipData.newPlainText("", text)
  val sensitiveExtra = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    ClipDescription.EXTRA_IS_SENSITIVE
  } else {
    "android.content.extra.IS_SENSITIVE"
  }
  clip.description.extras = PersistableBundle().apply { putBoolean(sensitiveExtra, true) }
  context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(clip)
}

@Composable
private fun CapabilityPanelLinks(links: List<JSONObject>, busy: Boolean, onOpen: (String) -> Unit) {
  val colors = MaterialTheme.colorScheme
  Column(Modifier.fillMaxWidth().testTag("capability-panel-links"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    for (link in links) {
      val label = link.value("label") ?: continue
      val url = safeHttpsUrl(link.value("url")) ?: continue
      Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(themedCorners(14))
        .background(colors.surfaceContainerLow).clickable(enabled = !busy, role = Role.Button) { onOpen(url) }
        .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = colors.primary)
        ActionIcon(R.drawable.action_chevron_right, color = colors.primary, contentDescription = null, size = 14.dp)
      }
    }
  }
}

@Composable
private fun CapabilityInput(field: JSONObject, values: Map<String, String>, busy: Boolean,
  onChange: (String, String) -> Unit, onSearch: () -> Unit = {}) {
      val id = field.getString("id")
      val rawLabel = field.getString("label")
      val required = field.optBoolean("required")
      val label = if (required) "$rawLabel *" else rawLabel
      val description = field.value("description")
      val format = field.value("format")
      val isJson = format == "json" || id == "mcp-json"
      val isUrl = format == "url" || id == "url"
      val isCode = format == "code" || isJson || isUrl || id in setOf("mcp-json", "url", "command", "args", "cwd")
      val value = values[id].orEmpty()
      val change: (String) -> Unit = { onChange(id, it) }
      Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      when (field.getString("type")) {
        "list" -> {
          val groups = value.lineSequence().map(String::trim).filter(String::isNotEmpty).distinct().toList()
          var pending by remember(id, value) { mutableStateOf("") }
          val removeLabel = capabilityLabel("移除", "Remove")
          val addLabel = field.value("addLabel") ?: capabilityLabel("添加项目", "Add item")
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
              TextButton(onClick = addGroup, enabled = !busy && pending.isNotBlank()) { Text(addLabel) }
            }
          }
        }
        "toggle" -> Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(14))
          .padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(rawLabel, Modifier.weight(1f))
          Switch(checked = value == "true", onCheckedChange = { change(it.toString()) }, enabled = !busy,
            modifier = Modifier.semantics { contentDescription = rawLabel }.testTag("capability-field-$id"))
        }
        "headers" -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text(label, style = MaterialTheme.typography.labelLarge)
          CapabilityKeyValueEditor(field, id, value, busy, change)
        }
        "select" -> {
          val options = field.objects("options")
          var open by remember(id) { mutableStateOf(false) }
          if (field.value("presentation") == "segmented") {
            CapabilityModeSelector(id, rawLabel, options, value, busy, change)
          } else Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(14)).padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            Box {
              TextButton(onClick = { open = true }, enabled = !busy,
                modifier = Modifier.testTag("capability-field-$id")) {
                Text(options.firstOrNull { it.optString("id") == value }?.optString("label") ?: rawLabel)
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
          keyboardOptions = KeyboardOptions(
            keyboardType = when {
              isUrl -> KeyboardType.Uri
              field.value("type") == "secret" -> KeyboardType.Password
              else -> KeyboardType.Text
            },
            autoCorrectEnabled = !isCode && field.value("type") != "secret",
            imeAction = if (id == "query") ImeAction.Search else ImeAction.Default),
          keyboardActions = KeyboardActions(onSearch = { onSearch() }),
          singleLine = field.value("type") != "multiline",
          minLines = if (isJson) 5 else 1,
          maxLines = when { isJson -> 9; id == "args" -> 6; else -> Int.MAX_VALUE },
          textStyle = if (isJson) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
            else MaterialTheme.typography.bodyLarge,
          visualTransformation = if (field.value("type") == "secret") PasswordVisualTransformation()
            else VisualTransformation.None)
      }
      if (description != null) {
        Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.padding(horizontal = 4.dp))
      }
      }
}

private fun capabilityItemVisible(item: JSONObject, values: Map<String, String>): Boolean {
  val condition = item.optJSONObject("visibleWhen") ?: return true
  return values[condition.getString("field")].orEmpty() == condition.getString("value")
}

@Composable
private fun CapabilityModeSelector(id: String, label: String, options: List<JSONObject>, value: String,
  busy: Boolean, onChange: (String) -> Unit) {
  val colors = MaterialTheme.colorScheme
  Row(Modifier.fillMaxWidth().background(colors.surfaceContainer, themedCorners(14)).padding(4.dp)
    .selectableGroup().semantics { contentDescription = label }.testTag("capability-field-$id"),
    horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    for (option in options) {
      val key = option.getString("id")
      val selected = value == key
      Box(Modifier.weight(1f).heightIn(min = 44.dp).clip(themedCorners(10))
        .background(if (selected) colors.surface else Color.Transparent)
        .selectable(selected, enabled = !busy, role = Role.Tab, onClick = { onChange(key) })
        .testTag("capability-option-$key"),
        contentAlignment = Alignment.Center) {
        Text(option.getString("label"), Modifier.padding(horizontal = 4.dp, vertical = 6.dp),
          color = if (selected) colors.primary else colors.onSurfaceVariant,
          style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center)
      }
    }
  }
}

@Composable
private fun CapabilityKeyValueEditor(field: JSONObject, id: String, encoded: String, busy: Boolean, onChange: (String) -> Unit) {
  val rows = remember(encoded) {
    val input = runCatching { JSONArray(encoded) }.getOrNull()
    List(input?.length() ?: 0) { index ->
      val row = input?.optJSONArray(index)
      row?.optString(0).orEmpty() to row?.optString(1).orEmpty()
    }.ifEmpty { listOf("" to "") }
  }
  fun update(next: List<Pair<String, String>>) {
    onChange(JSONArray(next.map { (name, value) -> JSONArray(listOf(name, value)) }).toString())
  }
  val environment = id == "mcp-env"
  val prefix = if (environment) "mcp-env" else "mcp-header"
  val nameLabel = field.value("keyLabel") ?: if (environment) capabilityLabel("变量名", "Variable name") else capabilityLabel("请求头名称", "Header name")
  val valueLabel = field.value("valueLabel") ?: if (environment) capabilityLabel("变量值", "Variable value") else capabilityLabel("请求头值", "Header value")
  val keyPlaceholder = field.value("keyPlaceholder") ?: if (environment) "API_KEY" else "X-API-Key"
  val addLabel = field.value("addLabel") ?: if (environment) capabilityLabel("添加变量", "Add variable") else capabilityLabel("添加请求头", "Add header")
  val maxItems = field.optInt("maxItems", if (environment) 32 else 16).coerceAtLeast(1)
  val removeLabel = if (environment) capabilityLabel("移除变量", "Remove variable") else capabilityLabel("移除请求头", "Remove header")
  Column(Modifier.fillMaxWidth().testTag("capability-field-$id"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    rows.forEachIndexed { index, (name, value) ->
      Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          val fieldColors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent)
          TextField(name, { text -> update(rows.toMutableList().apply { this[index] = text to value }) },
            Modifier.fillMaxWidth().testTag("$prefix-name-$index"), enabled = !busy,
            label = { Text(nameLabel) }, placeholder = { Text(keyPlaceholder) }, singleLine = true,
            shape = themedCorners(12), colors = fieldColors, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false))
          TextField(value, { text -> update(rows.toMutableList().apply { this[index] = name to text }) },
            Modifier.fillMaxWidth().testTag("$prefix-value-$index"), enabled = !busy,
            label = { Text(valueLabel) }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
            shape = themedCorners(12), colors = fieldColors, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        }
        if (rows.size > 1) {
          IconButton(onClick = { update(rows.filterIndexed { rowIndex, _ -> rowIndex != index }) }, enabled = !busy) {
            ActionIcon(R.drawable.action_close, contentDescription = removeLabel, size = 16.dp)
          }
        }
      }
    }
    if (rows.size < maxItems) {
      TextButton(onClick = { update(rows + ("" to "")) }, enabled = !busy) {
        ActionIcon(R.drawable.action_add, color = MaterialTheme.colorScheme.primary, contentDescription = null, size = 16.dp)
        Spacer(Modifier.size(6.dp))
        Text(addLabel)
      }
    }
  }
}
