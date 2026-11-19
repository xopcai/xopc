package ai.xopc.mobile.ui.main

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
  setCapability: suspend (String, Boolean, String) -> Unit = { _, _, _ -> },
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
    }, useComputer = { perform { openChat(it) } }, onCapabilityChanged = { name, allowed, deviceId ->
      perform {
        setCapability(name, allowed, deviceId)
        attempt++
      }
    })
}

@Composable
private fun DeviceConnectionsContent(
  data: DeviceConnections?, selection: String?, failed: Boolean, actionFailed: Boolean, busy: Boolean, zh: Boolean,
  onSelect: (String?) -> Unit, retry: () -> Unit, pair: () -> Unit, useTool: (String) -> Unit, useComputer: (String) -> Unit,
  onCapabilityChanged: (String, Boolean, String) -> Unit,
) {
  val colors = MaterialTheme.colorScheme
  val selected = data?.devices?.find { it.id == selection }
  val current = data?.devices?.find { it.id == data.currentDeviceId }
  val computers = data?.devices.orEmpty().filter { it.kind == "desktop" }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 4.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp)) {
    if (failed || actionFailed) {
      Text(if (zh) "设备暂不可用，请检查连接或授权后重试。" else "Device unavailable. Check its connection and access.",
        color = colors.error)
      TextButton(onClick = retry) { Text(if (zh) "重试" else "Retry") }
    }
    if (data == null && !failed) {
      CapabilityListSkeleton()
    } else if (selected != null) {
      TextButton(onClick = { onSelect(null) }, modifier = Modifier.testTag("device-connections-back")) { Text(if (zh) "返回设备连接" else "Back to devices") }
      DeviceConnectionRow(selected.name, selected.platform + " · " + deviceState(selected, zh), computerIcon(selected))
      if (selected.availability == "offline") {
        Text(if (zh) "在这台电脑上打开 xopc 并检查网络连接。" else "Open xopc on this computer and check its network connection.")
      } else {
        Text(if (zh) "本地文件" else "Local files", style = MaterialTheme.typography.titleSmall)
        val presets = listOf(
          Triple("desktop", if (zh) "桌面" else "Desktop", R.drawable.material_desktop_windows),
          Triple("documents", if (zh) "文稿" else "Documents", R.drawable.material_description),
          Triple("downloads", if (zh) "下载" else "Downloads", R.drawable.material_download),
        )
        val authorized = if (zh) "已授权 · 只读" else "Authorized · Read-only"
        presets.forEach { (kind, name, icon) ->
          val detail = if (selected.folders.any { it.kind == kind }) authorized
            else if (zh) "需在电脑上授权" else "Authorize on computer"
          DeviceConnectionRow(name, detail, icon)
        }
        selected.folders.filter { it.kind == "custom" }.forEach { folder ->
          DeviceConnectionRow(folder.label, authorized, R.drawable.material_folder_open)
        }
        if (selected.platform in setOf("darwin", "win32")) {
          Text(if (zh) "电脑控制" else "Computer use", style = MaterialTheme.typography.titleSmall)
          DeviceConnectionRow(if (zh) "操作应用窗口" else "Operate application windows",
            if (zh) "在电脑的设置中授权" else "Authorize in settings on the computer", R.drawable.material_select_window)
        }
        Button(onClick = { selected.endpointId?.let(useComputer) }, enabled = !busy && !failed && selected.endpointId != null && selected.folders.isNotEmpty(),
          modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("device-use-in-chat")) {
          Text(if (zh) "在聊天中使用" else "Use in chat")
        }
      }
    } else if (data != null) {
      if (current != null) {
        Text(if (zh) "当前设备" else "Current device", style = MaterialTheme.typography.titleSmall)
        DeviceConnectionRow(current.name, if (zh) "本机" else "This phone", R.drawable.action_phone)
        val tools = listOf(
          DeviceTool("mobile.file.pick", if (zh) "文件" else "Files",
            if (zh) "从系统文件中选择" else "Choose from system files", R.drawable.material_folder_open),
          DeviceTool("mobile.media.pick", if (zh) "照片" else "Photos",
            if (zh) "从系统相册中选择" else "Choose a photo", R.drawable.material_photo_library),
          DeviceTool("mobile.contacts.pick", if (zh) "联系人" else "Contacts",
            if (zh) "选择一个电话或邮箱" else "Choose a phone number or email", R.drawable.material_contacts),
          DeviceTool("mobile.calendar.query_events", if (zh) "日历" else "Calendar",
            if (zh) "使用时请求授权" else "Asks for access when used", R.drawable.material_calendar_month),
          DeviceTool("mobile.device.get_location", if (zh) "位置" else "Location",
            if (zh) "按次共享位置" else "Share your location once", R.drawable.material_location_on),
        )
        val reported = current.capabilities
        if (reported == null) {
          tools.filter { it.id in current.tools }.forEach { tool ->
            DeviceConnectionRow(tool.name, tool.description, tool.icon, if (busy) null else ({ useTool(tool.id) }))
          }
        } else {
          Text(if (zh) "允许当前 Gateway 使用" else "Allow the current Gateway to use",
            style = MaterialTheme.typography.titleSmall)
          if (reported.isEmpty()) Text(if (zh) "设备连接后会在这里显示已上报的能力。" else "Reported capabilities appear here when connected.")
          reported.forEach { capability ->
            val title = if (zh) capability.titleZh else capability.title
            val known = tools.find { it.id == capability.name }
            val status = if (capability.allowed) (if (zh) "已授权" else "Authorized") else (if (zh) "未授权" else "Not authorized")
            CapabilityCard(title, status, onClick = if (!busy && known != null) ({ useTool(capability.name) }) else null,
              leading = { CapabilityLogo(reference = null, origin = null, label = "", fallback = known?.icon ?: reportedToolIcon(capability.name)) },
              trailing = {
                Switch(checked = capability.allowed, enabled = !busy && !failed, onCheckedChange = { onCapabilityChanged(capability.name, it, current.id) },
                  modifier = Modifier.testTag("device-grant-${capability.name}").semantics {
                    contentDescription = if (zh) "允许 Gateway 使用${title}" else "Allow Gateway to use ${title}"
                  })
              })
          }
        }
      }
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(if (zh) "已连接电脑" else "Connected computers", style = MaterialTheme.typography.titleSmall)
        TextButton(onClick = pair) { Text(if (zh) "配对设备" else "Pair device") }
      }
      if (computers.isEmpty()) {
        Text(if (zh) "在电脑上打开 xopc，然后扫描配对码。" else "Open xopc on your computer, then scan its pairing code.",
          Modifier.padding(horizontal = 14.dp, vertical = 12.dp), color = colors.onSurfaceVariant)
      }
      computers.forEach { device ->
        DeviceConnectionRow(device.name, device.platform + " · " + deviceState(device, zh), computerIcon(device)) { onSelect(device.id) }
      }
    }
  }
}

private fun deviceState(device: ConnectedDevice, zh: Boolean) =
  if (device.availability == "offline") (if (zh) "离线" else "Offline") else (if (zh) "在线" else "Online")

private data class DeviceTool(val id: String, val name: String, val description: String, val icon: Int)

private fun reportedToolIcon(name: String) = when {
  name.startsWith("mobile.calendar.") -> R.drawable.material_calendar_month
  name.startsWith("mobile.contacts.") -> R.drawable.material_contacts
  name.startsWith("mobile.media.") || name.startsWith("mobile.camera.") -> R.drawable.material_photo_library
  else -> R.drawable.action_phone
}

private fun computerIcon(device: ConnectedDevice) =
  if (device.platform == "darwin") R.drawable.material_laptop_mac else R.drawable.material_desktop_windows

@Composable
private fun DeviceConnectionRow(name: String, detail: String, icon: Int, action: (() -> Unit)? = null) {
  CapabilityCard(name, detail, onClick = action,
    leading = { CapabilityLogo(reference = null, origin = null, label = "", fallback = icon) },
    trailing = if (action == null) null else ({
      ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 14.dp)
    }))
}
