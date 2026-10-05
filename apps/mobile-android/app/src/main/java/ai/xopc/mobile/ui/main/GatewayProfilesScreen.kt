package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayProfile
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
internal fun GatewayProfilesScreen(state: ConnectionUiState, insets: PaddingValues,
  onBack: () -> Unit, onAdd: () -> Unit, onRefresh: () -> Unit,
  onProbe: (String) -> Unit, onActivate: (String) -> Unit,
  onRename: (String, String) -> Unit, onRemove: (String) -> Unit) {
  var expandedId by rememberSaveable { mutableStateOf("") }
  var editingId by rememberSaveable { mutableStateOf("") }
  var editedName by rememberSaveable { mutableStateOf("") }
  var removingId by rememberSaveable { mutableStateOf("") }
  LaunchedEffect(state.gatewayProfiles) {
    if (editingId.isNotEmpty() && state.gatewayProfiles.firstOrNull { it.gatewayId == editingId }
        ?.name == editedName.trim()) editingId = ""
  }
  Column(Modifier.fillMaxSize().padding(insets).testTag("gateway-profiles-screen")) {
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 12.dp, top = 8.dp, bottom = 12.dp),
      verticalAlignment = Alignment.CenterVertically) {
      IconButton(onClick = onBack, enabled = !state.gatewayBusy,
        modifier = Modifier.testTag("gateways-back")) { Text("‹", style = MaterialTheme.typography.headlineMedium) }
      Text(stringResource(R.string.gateways_title), modifier = Modifier.weight(1f).padding(start = 4.dp),
        style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
      IconButton(onClick = onRefresh, enabled = !state.gatewayBusy,
        modifier = Modifier.testTag("gateways-refresh")) { Text("↻", style = MaterialTheme.typography.titleLarge) }
      IconButton(onClick = onAdd, enabled = !state.gatewayBusy,
        modifier = Modifier.testTag("gateways-add")) { Text("+", style = MaterialTheme.typography.titleLarge) }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      item {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(bottom = 6.dp)) {
          Text(stringResource(R.string.gateways_heading), style = MaterialTheme.typography.titleSmall)
          Text(stringResource(R.string.gateways_hint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      items(state.gatewayProfiles, key = { it.gatewayId }) { profile ->
        val id = profile.gatewayId
        val active = state.profile?.gatewayId == id
        val probe = state.gatewayProbes[id]
        Column(Modifier.fillMaxWidth().background(if (active) MaterialTheme.colorScheme.primaryContainer
          else MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(18.dp))
          .padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
          Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable { expandedId = if (expandedId == id) "" else id }
            .testTag("gateway-select-$id"), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("◉", color = MaterialTheme.colorScheme.primary,
              style = MaterialTheme.typography.titleLarge)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
              Text(profile.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
              Text(gatewayOrigin(profile), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                overflow = TextOverflow.Ellipsis)
            }
            if (active) Text(stringResource(R.string.gateways_current),
              color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelSmall)
            Text(if (expandedId == id) "⌃" else "⌄",
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          Text(stringResource(when (probe?.phase) {
            "online" -> R.string.gateways_online
            "degraded" -> R.string.gateways_degraded
            "offline" -> R.string.gateways_offline
            else -> R.string.gateways_checking
          }) + (probe?.result?.let { " · ${it.latencyMs} ms" } ?: ""),
            style = MaterialTheme.typography.bodySmall,
            color = if (probe?.phase == "offline") MaterialTheme.colorScheme.error
              else MaterialTheme.colorScheme.onSurfaceVariant)
          if (expandedId == id) {
            if (probe?.phase == "offline") Text(stringResource(when (probe.error) {
              "DEVICE_AUTH_DENIED", "NOT_PAIRED" -> R.string.gateways_probe_auth
              "GATEWAY_IDENTITY_MISMATCH" -> R.string.gateways_probe_identity
              else -> R.string.gateways_probe_network
            }), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            probe?.result?.let { result ->
              Text(result.routeUrl, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                overflow = TextOverflow.Ellipsis)
            }
            if (!active) Button(onClick = { onActivate(id) },
              enabled = !state.gatewayBusy && probe?.phase in setOf("online", "degraded"),
              modifier = Modifier.fillMaxWidth().testTag("gateway-switch-$id")) {
              Text(stringResource(R.string.gateways_switch))
            }
            OutlinedButton(onClick = { onProbe(id) },
              enabled = !state.gatewayBusy && probe?.phase != "checking",
              modifier = Modifier.fillMaxWidth().testTag("gateway-check-$id")) {
              Text(stringResource(R.string.gateways_check))
            }
            if (editingId == id) {
              OutlinedTextField(editedName, { editedName = it.take(80) },
                modifier = Modifier.fillMaxWidth().testTag("gateway-name"),
                label = { Text(stringResource(R.string.gateways_name)) }, singleLine = true)
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { editingId = "" }, enabled = !state.gatewayBusy) {
                  Text(stringResource(R.string.conversations_cancel))
                }
                TextButton(onClick = { onRename(id, editedName) },
                  enabled = !state.gatewayBusy && editedName.isNotBlank(),
                  modifier = Modifier.testTag("gateway-rename-save")) {
                  Text(stringResource(R.string.progress_save))
                }
              }
            } else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              TextButton(onClick = { editingId = id; editedName = profile.name }, enabled = !state.gatewayBusy) {
                Text(stringResource(R.string.gateways_rename))
              }
              TextButton(onClick = { removingId = id }, enabled = !state.gatewayBusy,
                modifier = Modifier.testTag("gateway-remove-$id")) {
                Text(stringResource(R.string.gateways_remove), color = MaterialTheme.colorScheme.error)
              }
            }
          }
        }
      }
      if (state.gatewayProfiles.isEmpty()) item {
        Text(stringResource(R.string.gateways_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      if (state.gatewayError != null) item {
        Text(stringResource(R.string.gateways_failed), color = MaterialTheme.colorScheme.error,
          modifier = Modifier.testTag("gateways-error"))
      }
    }
  }
  if (removingId.isNotBlank()) AlertDialog(onDismissRequest = { removingId = "" },
    title = { Text(stringResource(R.string.gateways_remove)) },
    text = { Text(stringResource(R.string.gateways_remove_hint)) },
    confirmButton = { TextButton(onClick = {
      val id = removingId; removingId = ""; onRemove(id)
    }, modifier = Modifier.testTag("gateway-remove-confirm")) {
      Text(stringResource(R.string.gateways_remove), color = MaterialTheme.colorScheme.error)
    } },
    dismissButton = { TextButton(onClick = { removingId = "" }) {
      Text(stringResource(R.string.conversations_cancel))
    } })
}

private fun gatewayOrigin(profile: GatewayProfile): String = profile.routes
  .firstOrNull { it.id == profile.activeRouteId }?.url.orEmpty().removePrefix("https://")
