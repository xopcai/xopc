package ai.xopc.mobile.ui.main

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConnectedDevice
import ai.xopc.mobile.gateway.DeviceConnections
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
internal fun DeviceConnectionsScreen(
  load: suspend () -> DeviceConnections, openChat: suspend (String) -> Unit,
  shareFile: suspend (Uri) -> Unit, useLocalTool: (String) -> Unit, pair: () -> Unit,
  active: Boolean = true,
) {
  var data by remember { mutableStateOf<DeviceConnections?>(null) }
  var selection by remember { mutableStateOf<String?>(null) }
  var failed by remember { mutableStateOf(false) }
  var actionFailed by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var attempt by remember { mutableStateOf(0) }
  val scope = rememberCoroutineScope()
  val zh = LocalConfiguration.current.locales[0].language == "zh"
  fun perform(action: suspend () -> Unit) {
    if (busy) return
    scope.launch {
      busy = true
      actionFailed = false
      try { action() }
      catch (error: CancellationException) { throw error }
      catch (_: Exception) { actionFailed = true }
      finally { busy = false }
    }
  }
  val documents = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
    if (uri != null) perform { shareFile(uri) }
  }
  val photos = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) perform { shareFile(uri) }
  }
  LaunchedEffect(active, attempt) {
    if (!active) return@LaunchedEffect
    do {
      try { data = load(); failed = false }
      catch (error: CancellationException) { throw error }
      catch (_: Exception) { failed = true }
      delay(5_000)
    } while (true)
  }
  BackHandler(active && selection != null) { selection = null; actionFailed = false }
  DeviceConnectionsContent(data, selection, failed, actionFailed, busy, zh,
    onSelect = { selection = it; actionFailed = false }, retry = { attempt++ }, pair = pair,
    useTool = { tool ->
      when (tool) {
        "mobile.file.pick" -> documents.launch(arrayOf("*/*"))
        "mobile.media.pick" -> photos.launch("image/*")
        else -> useLocalTool(tool)
      }
    }, useComputer = { perform { openChat(it) } })
}

@Composable
private fun DeviceConnectionsContent(
  data: DeviceConnections?, selection: String?, failed: Boolean, actionFailed: Boolean, busy: Boolean, zh: Boolean,
  onSelect: (String?) -> Unit, retry: () -> Unit, pair: () -> Unit, useTool: (String) -> Unit, useComputer: (String) -> Unit,
) {
  val colors = MaterialTheme.colorScheme
  val selected = data?.devices?.find { it.id == selection }
  val current = data?.devices?.find { it.id == data.currentDeviceId }
  val computers = data?.devices.orEmpty().filter { it.kind == "desktop" }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 10.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp)) {
    if (failed || actionFailed) {
      Text(if (zh) "设备暂不可用，请检查连接或授权后重试。" else "Device unavailable. Check its connection and access.",
        color = colors.error)
      TextButton(onClick = retry) { Text(if (zh) "重试" else "Retry") }
    }
    if (data == null && !failed) {
      repeat(3) { Surface(Modifier.fillMaxWidth().height(56.dp), RoundedCornerShape(12.dp), color = colors.surfaceContainer) {} }
    } else if (selected != null) {
      TextButton(onClick = { onSelect(null) }, modifier = Modifier.testTag("device-connections-back")) { Text(if (zh) "返回设备连接" else "Back to devices") }
      Text(selected.name, style = MaterialTheme.typography.titleLarge)
      Text(selected.platform + " · " + deviceState(selected, zh), color = colors.onSurfaceVariant)
      if (selected.availability == "offline") {
        Text(if (zh) "在这台电脑上打开 xopc 并检查网络连接。" else "Open xopc on this computer and check its network connection.")
      } else {
        Text(if (zh) "本地文件" else "Local files", style = MaterialTheme.typography.titleSmall)
        Surface(shape = RoundedCornerShape(14.dp), color = colors.surfaceContainer) {
          Column {
            val presets = listOf("desktop" to (if (zh) "桌面" else "Desktop"),
              "documents" to (if (zh) "文稿" else "Documents"), "downloads" to (if (zh) "下载" else "Downloads"))
            presets.forEach { (kind, name) ->
              DeviceConnectionRow(name, if (selected.folders.any { it.kind == kind }) (if (zh) "已授权 · 只读" else "Authorized · Read-only")
                else (if (zh) "需在电脑上授权" else "Authorize on computer"), R.drawable.action_capabilities)
              HorizontalDivider()
            }
            selected.folders.filter { it.kind == "custom" }.forEach { folder ->
              DeviceConnectionRow(folder.label, if (zh) "已授权 · 只读" else "Authorized · Read-only", R.drawable.action_capabilities)
            }
          }
        }
        if (selected.platform in setOf("darwin", "win32")) {
          Text(if (zh) "电脑控制" else "Computer use", style = MaterialTheme.typography.titleSmall)
          Surface(shape = RoundedCornerShape(14.dp), color = colors.surfaceContainer) {
            DeviceConnectionRow(if (zh) "操作应用窗口" else "Operate application windows",
              if (zh) "在电脑的设置中授权" else "Authorize in settings on the computer", R.drawable.action_capabilities)
          }
        }
        Button(onClick = { selected.endpointId?.let(useComputer) }, enabled = !busy && !failed && selected.endpointId != null && selected.folders.isNotEmpty(),
          modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("device-use-in-chat")) {
          Text(if (zh) "在聊天中使用" else "Use in chat")
        }
      }
    } else if (data != null) {
      if (current != null) {
        Text(if (zh) "当前设备" else "Current device", style = MaterialTheme.typography.titleSmall)
        Surface(shape = RoundedCornerShape(14.dp), color = colors.surfaceContainer) {
          Column {
            DeviceConnectionRow(current.name, if (zh) "本机" else "This phone", R.drawable.action_phone)
            val tools = listOf(
              Triple("mobile.file.pick", "文件" to "Files", "从系统文件中选择" to "Choose from system files"),
              Triple("mobile.media.pick", "照片" to "Photos", "从系统相册中选择" to "Choose a photo"),
              Triple("mobile.contacts.pick", "联系人" to "Contacts", "选择一个电话或邮箱" to "Choose a phone number or email"),
              Triple("mobile.calendar.query_events", "日历" to "Calendar", "使用时请求授权" to "Asks for access when used"),
              Triple("mobile.device.get_location", "位置" to "Location", "按次共享位置" to "Share your location once"))
            tools.filter { it.first in current.tools }.forEach { (tool, title, detail) ->
              HorizontalDivider()
              DeviceConnectionRow(if (zh) title.first else title.second, if (zh) detail.first else detail.second,
                R.drawable.action_capabilities, if (busy) null else ({ useTool(tool) }))
            }
          }
        }
      }
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(if (zh) "已连接电脑" else "Connected computers", style = MaterialTheme.typography.titleSmall)
        TextButton(onClick = pair) { Text(if (zh) "配对设备" else "Pair device") }
      }
      Surface(shape = RoundedCornerShape(14.dp), color = colors.surfaceContainer) {
        Column {
          if (computers.isEmpty()) Text(if (zh) "在电脑上打开 xopc，然后扫描配对码。" else "Open xopc on your computer, then scan its pairing code.",
            Modifier.padding(12.dp))
          computers.forEachIndexed { index, device ->
            if (index > 0) HorizontalDivider()
            DeviceConnectionRow(device.name, device.platform + " · " + deviceState(device, zh), R.drawable.action_phone) { onSelect(device.id) }
          }
        }
      }
    }
  }
}

private fun deviceState(device: ConnectedDevice, zh: Boolean) =
  if (device.availability == "offline") (if (zh) "离线" else "Offline") else (if (zh) "在线" else "Online")

@Composable
private fun DeviceConnectionRow(name: String, detail: String, icon: Int, action: (() -> Unit)? = null) {
  val modifier = if (action == null) Modifier else Modifier.clickable(onClick = action)
  Row(modifier.fillMaxWidth().heightIn(min = 54.dp).padding(horizontal = 12.dp, vertical = 8.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
    ActionIcon(icon, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 18.dp)
    Column(Modifier.weight(1f)) {
      Text(name, style = MaterialTheme.typography.bodyMedium)
      Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
    if (action != null) ActionIcon(R.drawable.action_chevron_right, size = 14.dp)
  }
}
