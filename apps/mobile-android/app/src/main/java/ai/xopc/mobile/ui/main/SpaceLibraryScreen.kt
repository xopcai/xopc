package ai.xopc.mobile.ui.main

import ai.xopc.mobile.playback.MusicPlayback
import ai.xopc.mobile.playback.MusicTrack
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ChatAttachmentStore
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.LibraryItem
import ai.xopc.mobile.gateway.LibraryOrigin
import ai.xopc.mobile.gateway.LibraryShare
import ai.xopc.mobile.gateway.LibraryVersion
import ai.xopc.mobile.gateway.SpaceLibraryAccess
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.io.File
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val fileKinds = listOf("", "document", "spreadsheet", "presentation", "image", "audio", "video", "archive", "file")
private val englishKinds = listOf("All types", "Documents", "Spreadsheets", "Slides", "Images", "Audio", "Video", "Archives", "Files")
private val chineseKinds = listOf("全部类型", "文档", "表格", "演示", "图片", "音频", "视频", "压缩包", "文件")

@Composable
internal fun SpaceLibraryScreen(insets: PaddingValues, profile: GatewayProfile, access: SpaceLibraryAccess,
  onExit: () -> Unit, onSource: (LibraryOrigin) -> Unit,
  onUse: suspend (String, LibraryVersion, LibraryOrigin?) -> Unit,
) {
  val zh = LocalConfiguration.current.locales[0].language == "zh"
  fun t(zhText: String, enText: String) = if (zh) zhText else enText
  val kinds = if (zh) chineseKinds else englishKinds
  val coroutine = rememberCoroutineScope()
  var selected by rememberSaveable(profile.gatewayId, profile.deviceId) { mutableStateOf<String?>(null) }
  val navigation = rememberNavigationPreferences()
  var view by rememberSaveable(profile.gatewayId, profile.deviceId) {
    mutableStateOf(navigation.selection("library-scope", listOf("all", "favorites", "trash"), "all"))
  }
  var query by rememberSaveable(profile.gatewayId, profile.deviceId) { mutableStateOf("") }
  var kind by rememberSaveable(profile.gatewayId, profile.deviceId) {
    mutableStateOf(navigation.selection("library-kind", fileKinds, ""))
  }
  var filterMenu by remember { mutableStateOf(false) }
  var refresh by remember { mutableStateOf(0) }
  val cleanQuery = query.trim()
  val snapshot = remember(view, cleanQuery, kind, profile, access) { access.cached(profile, view, cleanQuery, kind) }
  var items by remember(view, cleanQuery, kind, profile, access) { mutableStateOf(snapshot?.items.orEmpty()) }
  var cursor by remember(view, cleanQuery, kind, profile, access) { mutableStateOf(snapshot?.cursor) }
  var loading by remember(view, cleanQuery, kind, profile) { mutableStateOf(true) }
  var failed by remember(view, cleanQuery, kind, profile) { mutableStateOf(false) }
  var undo by remember(view, profile) { mutableStateOf<Pair<String, Int>?>(null) }
  var undoBusy by remember(view, profile) { mutableStateOf(false) }
  var undoFailed by remember(view, profile) { mutableStateOf(false) }
  val formatter = DateFormat.getDateInstance(DateFormat.MEDIUM, LocalConfiguration.current.locales[0])

  LaunchedEffect(access, profile, view, cleanQuery, kind, refresh) {
    loading = true
    failed = false
    if (cleanQuery.isNotEmpty()) delay(250)
    try {
      val result = access.page(profile, view, cleanQuery, kind)
      items = result.items
      cursor = result.cursor
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      failed = true
    } finally { loading = false }
  }

  val scopes = listOf(
    SegmentOption("all", t("全部资料", "All files"), "space-tab-all"),
    SegmentOption("favorites", t("收藏", "Favorites"), "space-tab-favorites"),
    SegmentOption("trash", t("回收站", "Trash"), "space-tab-trash"),
  )
  fun selectScope(value: String) {
    if (view == value) return
    query = ""
    view = value
    navigation.rememberSelection("library-scope", value)
  }
  val activeID = selected
  Column(Modifier.fillMaxSize().padding(insets).testTag("space-library")) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
      PageBackButton("library-back", onExit)
      PageTitleMenu(scopes, view, "space-scope-menu", Modifier.align(Alignment.Center), ::selectScope)
    }
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
      OutlinedTextField(query, { query = it.take(160) }, Modifier.weight(1f).testTag("space-search"),
        singleLine = true, placeholder = { Text(t("搜索资料", "Search files")) },
        leadingIcon = { Icon(painterResource(R.drawable.action_search), contentDescription = null) },
        trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) {
          Icon(painterResource(R.drawable.action_close), t("清除搜索", "Clear search"))
        } }, shape = RoundedCornerShape(16.dp))
      Box {
        TextButton(onClick = { filterMenu = true }, Modifier.testTag("space-file-type")) {
          Text(kinds[fileKinds.indexOf(kind).coerceAtLeast(0)])
        }
        DropdownMenu(expanded = filterMenu, onDismissRequest = { filterMenu = false }) {
          fileKinds.forEachIndexed { index, type ->
            DropdownMenuItem(text = { Text(kinds[index]) }, onClick = {
              kind = type
              navigation.rememberSelection("library-kind", type)
              filterMenu = false
            })
          }
        }
      }
    }
    LazyColumn(Modifier.weight(1f).fillMaxWidth()
      .swipePageSelection(scopes.map { it.value }, view, activeID == null, ::selectScope), contentPadding = PaddingValues(horizontal = 16.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      if (loading && items.isEmpty()) items(5) {
        Box(Modifier.fillMaxWidth().height(55.dp).background(MaterialTheme.colorScheme.surfaceContainer,
          MaterialTheme.shapes.medium))
      } else if (failed) item {
        TextButton(onClick = { refresh++ }) { Text(t("加载失败，重试", "Could not load. Retry")) }
      } else if (items.isEmpty()) item {
        Text(when {
          query.isNotBlank() -> t("没有匹配的资料", "No matching results")
          view == "favorites" -> t("暂无收藏", "No favorites")
          view == "trash" -> t("回收站为空", "Trash is empty")
          else -> t("暂无资料", "No results yet")
        }, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      items(items, key = { it.id }) { file ->
        LibraryRow(file, date = formatter.format(Date(file.updatedAt)), zh = zh, onOpen = { selected = file.id })
      }
      cursor?.let { next -> item {
        TextButton(onClick = {
          loading = true
          coroutine.launch {
            val filterKey = Triple(view, cleanQuery, kind)
            try {
              val page = access.page(profile, filterKey.first, filterKey.second, filterKey.third, next)
              if (filterKey == Triple(view, query.trim(), kind)) {
                items = (items + page.items).distinctBy { it.id }
                cursor = page.cursor
              }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { failed = true }
            finally { loading = false }
          }
        }, enabled = !loading) { Text(t("加载更多", "Load more")) }
      } }
    }
    undo?.let { (id, revision) ->
      Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(if (undoFailed) t("操作未完成，请重试", "Could not complete the action. Try again.")
          else t("已移到回收站", "Moved to Trash"), Modifier.weight(1f))
        TextButton(onClick = {
          undoBusy = true
          coroutine.launch {
            try {
              access.mutate(profile, id, revision, "restore")
              undo = null; refresh++
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { undoFailed = true }
            finally { undoBusy = false }
          }
        }, enabled = !undoBusy) { Text(t("撤销", "Undo")) }
      }
    }
  }
  if (activeID != null) {
    val close = { selected = null }
    MobilePreviewSheet(close) {
      LibraryDetail(activeID, items.firstOrNull { it.id == activeID }, profile, access, zh,
        onBack = close, onChange = { refresh++ }, onTrash = { revision -> undo = activeID to revision; undoFailed = false },
        onSource = { close(); onSource(it) }, onUse = { item, version, source -> onUse(item, version, source); close() })
    }
  }
}

private fun sourceLabel(source: LibraryOrigin?, zh: Boolean): String? = source?.label ?: when (source?.kind) {
  "task" -> if (zh) "任务" else "Task"
  "automation" -> if (zh) "定时任务" else "Automation"
  "chat" -> if (zh) "对话" else "Chat"
  else -> null
}

@Composable
private fun LibraryRow(file: LibraryItem, date: String, zh: Boolean, onOpen: () -> Unit) {
  val extension = file.currentVersion.fileName.substringAfterLast('.', "").uppercase()
  val metadata = listOfNotNull(extension.takeIf(String::isNotBlank), sourceLabel(file.origin, zh), date).joinToString(" · ")
  Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(MaterialTheme.shapes.large)
    .background(MaterialTheme.colorScheme.surface)
    .clickable(onClick = onOpen).padding(12.dp).testTag("space-item-${file.id}"),
    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(40.dp).background(MaterialTheme.colorScheme.surfaceContainer, MaterialTheme.shapes.medium),
      contentAlignment = Alignment.Center) {
      val icon = when (file.kind) {
        "audio" -> R.drawable.action_waveform
        "image" -> R.drawable.action_photo
        "video" -> R.drawable.action_camera
        else -> R.drawable.tab_notes
      }
      ActionIcon(icon, color = MaterialTheme.colorScheme.primary, size = 21.dp)
    }
    Column(Modifier.weight(1f)) {
      Text(file.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (metadata.isNotEmpty()) Text(metadata, style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
      file.hit?.let { Text(it, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
    ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 14.dp)
  }
}

@Composable
private fun ColumnScope.LibraryDetail(id: String, summary: LibraryItem?, profile: GatewayProfile, access: SpaceLibraryAccess, zh: Boolean,
  onBack: () -> Unit, onChange: () -> Unit, onTrash: (Int) -> Unit, onSource: (LibraryOrigin) -> Unit,
  onUse: suspend (String, LibraryVersion, LibraryOrigin?) -> Unit,
) {
  fun t(zhText: String, enText: String) = if (zh) zhText else enText
  val context = LocalContext.current
  val coroutine = rememberCoroutineScope()
  var item by remember(id) { mutableStateOf(summary) }
  var detailLoaded by remember(id) { mutableStateOf(false) }
  var versionId by rememberSaveable(id) { mutableStateOf<String?>(null) }
  var busy by remember(id) { mutableStateOf(false) }
  var error by remember(id) { mutableStateOf("") }
  var rename by remember { mutableStateOf(false) }
  var title by remember { mutableStateOf("") }
  var purge by remember { mutableStateOf(false) }
  var sharedLink by remember(id) { mutableStateOf<LibraryShare?>(null) }
  var export by remember { mutableStateOf<File?>(null) }
  val picker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
    val temp = export
    export = null
    coroutine.launch {
      try {
        if (uri != null && temp != null) withContext(Dispatchers.IO) {
          val output = checkNotNull(context.contentResolver.openOutputStream(uri, "wt"))
          output.use { destination -> temp.inputStream().use { it.copyTo(destination) } }
        }
      } catch (cancelled: CancellationException) { throw cancelled }
      catch (_: Exception) { error = t("下载失败", "Download failed") }
      finally { temp?.delete(); busy = false }
    }
  }
  DisposableEffect(id) { onDispose { export?.delete() } }
  LaunchedEffect(access, profile, id) {
    try { item = access.detail(profile, id) }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (_: Exception) { error = t("资料暂不可用", "Result unavailable") }
    finally { detailLoaded = true }
  }
  fun run(operation: suspend () -> Unit) {
    if (busy) return
    busy = true
    error = ""
    coroutine.launch {
      try { operation() }
      catch (cancelled: CancellationException) { throw cancelled }
      catch (_: Exception) {
        error = t("操作未完成，请重试", "Could not complete the action. Try again.")
        try { item = access.detail(profile, id) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) {}
      } finally { if (export == null) busy = false }
    }
  }
  val file = item
  if (file == null) {
    PreviewHeader(t("预览", "Preview"), onBack)
    Text(if (error.isNotEmpty()) error else t("正在读取资料", "Loading preview"), Modifier.padding(16.dp))
    return
  }
  val version = file.versions.firstOrNull { it.id == versionId } ?: file.currentVersion
  val source = file.source(version)
  fun mutate(action: String, newTitle: String? = null, favorite: Boolean? = null) = run {
    val updated = access.mutate(profile, id, file.revision, action, newTitle, favorite)
    if (updated != null) item = updated
    else {
      if (action == "trash") onTrash(file.revision + 1)
      onBack()
    }
    onChange()
  }

  PreviewHeader(file.title, { if (!busy) onBack() }) { closeMenu ->
    if (!file.trashed) {
      if (version.mimeType.startsWith("audio/") || version.mimeType.startsWith("video/")) {
        DropdownMenuItem(text = { Text(t("分享链接", "Share link")) }, enabled = !busy, onClick = {
          closeMenu()
          run { sharedLink = access.share(profile, id, version) }
        })
      }
      DropdownMenuItem(text = { Text(t("下载", "Download")) }, enabled = !busy, onClick = {
        closeMenu()
        run {
          val target = File.createTempFile("space-export-", ".part", context.cacheDir)
          try {
            access.download(profile, id, version, target)
            export = target
            picker.launch(version.safeName)
          } catch (failure: Exception) { export = null; target.delete(); throw failure }
        }
      })
      DropdownMenuItem(text = { Text(if (file.favorite) t("取消收藏", "Unfavorite") else t("收藏", "Favorite")) },
        enabled = !busy, onClick = { closeMenu(); mutate("patch", favorite = !file.favorite) })
      DropdownMenuItem(text = { Text(t("重命名", "Rename")) }, enabled = !busy,
        onClick = { closeMenu(); title = file.title; rename = true })
      DropdownMenuItem(text = { Text(t("移到回收站", "Move to Trash"), color = MaterialTheme.colorScheme.error) },
        enabled = !busy, onClick = { closeMenu(); mutate("trash") })
    } else {
      DropdownMenuItem(text = { Text(t("恢复", "Restore")) }, enabled = !busy,
        onClick = { closeMenu(); mutate("restore") })
      DropdownMenuItem(text = { Text(t("永久删除", "Delete permanently"), color = MaterialTheme.colorScheme.error) },
        enabled = !busy, onClick = { closeMenu(); purge = true })
    }
    if (file.versions.size > 1) {
      val formatter = DateFormat.getDateInstance(DateFormat.SHORT, LocalConfiguration.current.locales[0])
      file.versions.forEach { entry ->
        val label = if (entry.id == file.currentVersion.id) t("最新版", "Latest") else formatter.format(Date(entry.createdAt))
        DropdownMenuItem(text = { Text("$label · v${entry.ordinal}") }, enabled = !busy,
          onClick = { versionId = entry.id; closeMenu() })
      }
    }
  }
  if (version.mimeType.startsWith("audio/") && !detailLoaded) {
    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { BrandLoadingIndicator(extent = 24.dp) }
  } else if (version.mimeType.startsWith("audio/")) {
    val music = version.music
    val track = MusicTrack(profile.gatewayId, music?.conversationId.orEmpty(), music?.id ?: version.id,
      file.title, source?.label.orEmpty(), music?.lyrics, music?.durationMs ?: 0, version.safeName)
    MusicPreviewContent(track, Modifier.weight(1f)) {
      MusicPlayback.play(context, track, { access.playbackUrl(profile, id, version) }) { destination ->
        access.download(profile, id, version, destination)
      }
    }
  } else {
    Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
      SpaceVersionPreview(modifier = Modifier.fillMaxSize(), id, version, profile, access, zh)
    }
  }
  if (version.id == file.currentVersion.id) summary?.hit?.let {
    Text(it, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.labelSmall, maxLines = 2)
  }
  if (!file.trashed) Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
    if (source != null) TextButton(onClick = { onSource(source) }, enabled = !busy) { Text(t("查看来源", "Open source")) }
    else Spacer(Modifier.weight(1f))
    TextButton(onClick = { run { onUse(id, version, source) } },
      enabled = !busy && version.sizeBytes in 1..ChatAttachmentStore.MAX_BYTES.toLong()) { Text(t("在对话中使用", "Use in chat")) }
  }
  if (error.isNotEmpty()) Text(error, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
  if (rename) AlertDialog(onDismissRequest = { rename = false }, title = { Text(t("重命名", "Rename")) },
    text = { OutlinedTextField(title, { title = it.take(240) }, singleLine = true) },
    confirmButton = { TextButton(enabled = title.isNotBlank(), onClick = { rename = false; mutate("patch", title.trim()) }) {
      Text(t("保存", "Save"))
    } }, dismissButton = { TextButton(onClick = { rename = false }) { Text(t("取消", "Cancel")) } })
  sharedLink?.let { link ->
    val reachability = when (link.reachability) {
      "public" -> t("公网可访问", "Publicly reachable")
      "lan" -> t("仅同一局域网可访问", "Reachable on the same LAN")
      else -> t("目前仅网关本机可访问", "Currently local to the gateway")
    }
    AlertDialog(onDismissRequest = { sharedLink = null }, title = { Text(t("分享链接", "Share link")) },
      text = { Text(reachability) },
      confirmButton = { TextButton(onClick = {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link.url)
        context.startActivity(Intent.createChooser(intent, t("分享链接", "Share link")))
        sharedLink = null
      }) { Text(t("分享", "Share")) } },
      dismissButton = { TextButton(onClick = { sharedLink = null }) { Text(t("关闭", "Close")) } })
  }
  if (purge) AlertDialog(onDismissRequest = { purge = false },
    title = { Text(t("永久删除「${file.title}」？", "Delete “${file.title}” permanently?")) },
    confirmButton = { TextButton(onClick = { purge = false; mutate("purge") }) { Text(t("删除", "Delete")) } },
    dismissButton = { TextButton(onClick = { purge = false }) { Text(t("取消", "Cancel")) } })
}

@Composable
private fun SpaceVersionPreview(modifier: Modifier, id: String, version: LibraryVersion, profile: GatewayProfile,
  access: SpaceLibraryAccess, zh: Boolean) {
  val media = version.mimeType.startsWith("video/")
  val bitmap = isBitmapPreview(version.fileName, version.mimeType)
  var bytes by remember(profile.gatewayId, version.id) { mutableStateOf<ByteArray?>(null) }
  var stream by remember(profile.gatewayId, version.id) { mutableStateOf<Uri?>(null) }
  var failed by remember(profile.gatewayId, version.id) { mutableStateOf(false) }
  var retry by remember(profile.gatewayId, version.id) { mutableStateOf(0) }
  val name = version.fileName
  val mime = version.mimeType
  LaunchedEffect(access, profile, id, version.id, retry) {
    failed = false
    stream = null
    try {
      if (media) {
        stream = Uri.parse(access.playbackUrl(profile, id, version))
      } else if ((bitmap || previewFileKind(name, mime) != PreviewFileKind.BINARY) && version.sizeBytes <= 16 * 1024 * 1024) {
        bytes = access.content(profile, id, version)
      } else failed = true
    } catch (cancelled: CancellationException) { throw cancelled }
    catch (_: Exception) { failed = true }
  }
  val source = stream
  val data = bytes
  when {
    source != null && !failed -> PreviewVideo(source, modifier, onError = { failed = true })
    data != null && bitmap -> {
      val decoded by androidx.compose.runtime.produceState<Pair<Boolean, android.graphics.Bitmap?>>(false to null, data) {
        value = true to kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
          decodeChatThumbnail(data, 2048)
        }
      }
      val image = decoded.second
      if (!decoded.first) BrandLoadingIndicator(extent = 24.dp)
      else if (image != null) ZoomableMessageImage(image, name, version.id, true, modifier) {}
      else Text(if (zh) "资料暂不可读" else "Content unavailable")
    }
    data != null -> FilePreviewContent(name, mime, data, modifier)
    failed && media -> TextButton(onClick = { retry++ }) { Text(if (zh) "无法播放，重试" else "Playback failed. Retry") }
    failed -> Text(if (zh) "资料暂不可读，可下载查看" else "Preview unavailable. Download to view.")
    else -> BrandLoadingIndicator(extent = 24.dp)
  }
}
