package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.CapabilityItem
import ai.xopc.mobile.gateway.CapabilityPage
import ai.xopc.mobile.gateway.ConversationAgent
import android.graphics.Bitmap
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

private enum class CapabilityCategory(val key: String, val title: Int, val icon: Int, val prompt: Int) {
  Plugins("plugins", R.string.capability_plugins, R.drawable.action_capabilities, R.string.capability_plugin_prompt),
  Skills("skills", R.string.capability_skills, R.drawable.action_task_list, R.string.capability_skill_prompt),
  Connections("connections", R.string.capability_connections, R.drawable.action_phone, R.string.capability_connection_prompt),
  Agents("agents", R.string.capability_agents, R.drawable.tab_assistant, R.string.capability_agent_prompt),
  Channels("channels", R.string.capability_channels, R.drawable.tab_conversations, R.string.capability_channel_prompt),
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

private fun channelIssue(code: String) = when (code) {
  "telegram.missing_credential" -> R.string.capability_channel_telegram
  "weixin.missing_account" -> R.string.capability_channel_weixin
  "feishu.missing_credentials" -> R.string.capability_channel_feishu
  else -> R.string.capability_channel_config
}

private fun administrationUrl(origin: String?, category: CapabilityCategory, item: CapabilityItem): String? {
  if (origin == null) return null
  val base = Uri.parse(origin)
  if (base.scheme != "https" || base.host == null || base.userInfo != null) return null
  val id = Uri.encode(item.targetId ?: item.id)
  val target = when (category) {
    CapabilityCategory.Plugins -> if (item.group == "available") "/capabilities/extensions" else "/capabilities/extensions/$id"
    CapabilityCategory.Channels -> "/capabilities/channels/$id"
    CapabilityCategory.Connections -> "/capabilities/connectors"
    else -> return null
  }
  return base.buildUpon().clearQuery().encodedFragment(target).build().toString()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CapabilitiesScreen(insets: PaddingValues, personal: PersonalUiState,
  agentAvatars: Map<String, Bitmap>,
  onLoad: suspend (String) -> CapabilityPage, onOpenAgent: (CapabilityItem) -> Unit,
  onOpenDraft: (String) -> Unit, onExit: () -> Unit, administrationOrigin: String? = null) {
  var category by remember { mutableStateOf(CapabilityCategory.Plugins) }
  var pages by remember { mutableStateOf(emptyMap<CapabilityCategory, CapabilityPage>()) }
  var failed by remember { mutableStateOf(false) }
  var loading by remember { mutableStateOf(true) }
  var retry by remember { mutableStateOf(0) }
  var menu by remember { mutableStateOf(false) }
  var query by remember(category) { mutableStateOf("") }
  var detail by remember(category) { mutableStateOf<CapabilityItem?>(null) }
  val list = rememberLazyListState()
  val keyboard = LocalSoftwareKeyboardController.current
  val context = LocalContext.current
  val browser = LocalUriHandler.current

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
  LaunchedEffect(category, query) { list.scrollToItem(0) }
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

  Column(Modifier.fillMaxSize().padding(insets).imePadding().padding(horizontal = 16.dp)) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
      IconButton(onClick = onExit, modifier = Modifier.align(Alignment.CenterStart)
        .background(MaterialTheme.colorScheme.surfaceContainer, CircleShape).testTag("capability-back")) {
        ActionIcon(R.drawable.action_chevron_left, contentDescription = stringResource(R.string.progress_back))
      }
      Box {
        TextButton(onClick = { keyboard?.hide(); menu = true }, modifier = Modifier.testTag("capability-category")) {
          Text(stringResource(category.title), style = MaterialTheme.typography.titleLarge)
          ActionIcon(R.drawable.action_chevron_down, modifier = Modifier.padding(start = 6.dp), size = 16.dp)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
          CapabilityCategory.entries.forEach { choice ->
            DropdownMenuItem(text = { Text(stringResource(choice.title)) }, onClick = { category = choice; menu = false },
              modifier = Modifier.testTag("capability-category-${choice.key}").semantics { selected = choice == category })
          }
        }
      }
      IconButton(onClick = { retry++ }, enabled = !loading, modifier = Modifier.align(Alignment.CenterEnd).testTag("capability-refresh")) {
        Text("↻", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics {
          contentDescription = context.getString(R.string.capability_retry)
        })
      }
    }
    LazyColumn(state = list, modifier = Modifier.weight(1f), contentPadding = PaddingValues(bottom = 10.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp)) {
      item {
        FilledTonalButton(onClick = {
          keyboard?.hide()
          val label = context.getString(category.title)
          onOpenDraft(if (search.isEmpty()) context.getString(R.string.capability_find_prompt, label)
            else context.getString(R.string.capability_find_query_prompt, label, JSONObject.quote(search)))
        }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("capability-discover"), shape = themedCorners(16)) {
          ActionIcon(R.drawable.tab_conversations, modifier = Modifier.padding(end = 8.dp), size = 18.dp)
          Text(stringResource(R.string.capability_discover))
        }
      }
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
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp, start = 4.dp))
        }
        items(rows, key = { it.id }) { row ->
          Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable { keyboard?.hide(); detail = row }
            .padding(horizontal = 4.dp).testTag("capability-row-${row.id}"),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).background(MaterialTheme.colorScheme.surfaceContainer, themedCorners(12)),
              contentAlignment = Alignment.Center) {
              when {
                row.personal -> PersonalAgentAvatar(personal.agentAvatar, agent?.appearance.orEmpty(), 36.dp, active = false)
                category == CapabilityCategory.Agents -> AgentAvatar(agentAvatars[row.id], row.avatar.orEmpty(), row.id, 36.dp, active = false)
                else -> ActionIcon(category.icon, color = MaterialTheme.colorScheme.primary, size = 22.dp)
              }
            }
            Column(Modifier.weight(1f)) {
              Text(row.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
              if (row.description.isNotBlank()) Text(row.description, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 18.dp)
          }
        }
      }
    }
    OutlinedTextField(query, { query = it.take(160) }, Modifier.fillMaxWidth().padding(bottom = 8.dp).testTag("capability-search"),
      placeholder = { Text(stringResource(R.string.capability_search, stringResource(category.title))) },
      shape = CircleShape, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      leadingIcon = { ActionIcon(R.drawable.action_search) }, trailingIcon = {
        if (query.isNotEmpty()) IconButton(onClick = { query = "" }, modifier = Modifier.testTag("capability-search-clear")) {
          ActionIcon(R.drawable.action_close, contentDescription = stringResource(R.string.capability_clear))
        }
      })
  }
  detail?.let { row ->
    val canStartChat = category == CapabilityCategory.Agents && row.group != "disabled"
    ModalBottomSheet(onDismissRequest = { detail = null }) {
      Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(row.name, style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(capabilityGroup(row.group)), color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (row.description.isNotBlank()) Text(row.description)
        row.version?.let { Text(stringResource(R.string.capability_version_label, it), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        row.issue?.let { Text(stringResource(channelIssue(it)), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (canStartChat) Button(onClick = { detail = null; onOpenAgent(row) },
          modifier = Modifier.fillMaxWidth().testTag("capability-start-chat")) {
          Text(stringResource(R.string.capability_start_chat))
        }
        if (!row.personal) {
          val open = { detail = null; onOpenDraft(context.getString(category.prompt, JSONObject.quote(row.id))) }
          val action = Modifier.fillMaxWidth().testTag("capability-open-chat")
          if (canStartChat) FilledTonalButton(onClick = open, modifier = action) {
            Text(stringResource(R.string.capability_open_chat))
          } else Button(onClick = open, modifier = action) { Text(stringResource(R.string.capability_open_chat)) }
        }
        administrationUrl(administrationOrigin, category, row)?.let { url ->
          TextButton(onClick = {
            try { browser.openUri(url) }
            catch (_: IllegalArgumentException) {
              Toast.makeText(context, R.string.capability_web_open_failed, Toast.LENGTH_SHORT).show()
            }
          }, modifier = Modifier.fillMaxWidth().testTag("capability-web-manage")) {
            Text(stringResource(R.string.capability_web_manage))
          }
        }
      }
    }
  }
}
