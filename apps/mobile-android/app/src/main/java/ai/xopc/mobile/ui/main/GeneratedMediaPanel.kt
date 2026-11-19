package ai.xopc.mobile.ui.main

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import java.io.File
import java.util.Locale

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GeneratedMediaAccess
import ai.xopc.mobile.gateway.GeneratedMediaItem
import ai.xopc.mobile.gateway.GeneratedMediaKind
import ai.xopc.mobile.gateway.GeneratedMediaScope
import ai.xopc.mobile.playback.MusicPlayback
import ai.xopc.mobile.playback.MusicTrack
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.xopc.mobile.theme.CHAT_MESSAGE_WIDTH
import ai.xopc.mobile.theme.LocalAttentionColors
import ai.xopc.mobile.theme.LocalChatColors

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
internal fun GeneratedMediaCard(
  item: GeneratedMediaItem,
  submitting: Boolean,
  confirmationFailed: Boolean,
  onPlay: () -> Unit,
  onConfirm: () -> Unit,
  musicTrack: MusicTrack? = null,
  onOpen: (() -> Unit)? = null,
  modifier: Modifier = Modifier,
) {
  val zh = LocalConfiguration.current.locales[0].language == "zh"
  val kindLabel = if (item.kind == GeneratedMediaKind.Music) label(zh, "音乐", "Music") else label(zh, "视频", "Video")
  val status = when (item.state) {
    "queued", "submitted" -> label(zh, "排队中", "Queued")
    "submitting" -> label(zh, "提交中", "Submitting")
    "running", "saving" -> label(zh, "生成中", "Generating")
    "failed" -> label(zh, "生成失败", "Generation failed")
    "submission_unknown" -> label(zh, "提交结果待确认", "Submission unconfirmed")
    "completed" -> label(zh, "可播放", "Ready to play")
    else -> label(zh, "待确认", "Review required")
  }
  val subtitle = if (item.kind == GeneratedMediaKind.Video) status else {
    listOfNotNull(status, item.version?.let { label(zh, "第 $it 版", "Version $it") },
      item.duration?.let(::mediaTime)).joinToString(" · ")
  }
  Surface(modifier = modifier.widthIn(max = 440.dp).fillMaxWidth().testTag("generated-media-card-${item.id}"),
    shape = MaterialTheme.shapes.large,
    color = if (item.isDraft && item.canConfirm) LocalAttentionColors.current.fill else LocalChatColors.current.card,
    contentColor = MaterialTheme.colorScheme.onSurface) {
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).then(if (onOpen == null) Modifier else Modifier
          .clickable(onClick = onOpen).testTag("generated-${item.kind.path}-open-${item.id}")),
          horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
          Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.secondaryContainer) {
            Box(Modifier.size(42.dp), contentAlignment = Alignment.Center) {
              Text(if (item.kind == GeneratedMediaKind.Music) "♫" else "▣", color = MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.titleLarge)
            }
          }
          Column {
            Text(item.title ?: kindLabel, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = if (item.kind == GeneratedMediaKind.Video) 1 else 2, overflow = TextOverflow.Ellipsis)
          }
        }
        if (musicTrack != null) {
          val playback by MusicPlayback.state.collectAsStateWithLifecycle()
          playback?.takeIf { it.track.key == musicTrack.key }?.let {
            MusicToggle(it, tag = "generated-media-play-${item.id}")
          }
        } else if (item.state == "completed") {
          val play = label(zh, "播放", "Play")
          FilledTonalIconButton(onClick = onPlay,
            colors = IconButtonDefaults.filledTonalIconButtonColors(contentColor = LocalChatColors.current.action), modifier = Modifier.testTag("generated-media-play-${item.id}")
            .semantics { contentDescription = play }) { Text("▶") }
        }
      }
      if (item.isDraft) {
        val credit = item.creditMicro
        val cost = item.costFen
        val estimate = when {
          credit != null -> label(zh, "预估 ${price(credit / 1_000_000.0)} 积分", "Estimated ${price(credit / 1_000_000.0)} credits")
          cost != null -> label(zh, "预估 ¥${price(cost / 100.0)}", "Estimated ¥${price(cost / 100.0)}")
          else -> null
        }
        estimate?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        Button(onClick = onConfirm, enabled = item.canConfirm && !submitting,
          modifier = Modifier.testTag("generated-video-confirm-${item.id}")) {
          Text(if (submitting) label(zh, "正在提交", "Submitting") else label(zh, "确认生成", "Generate video"))
        }
        if (!item.canConfirm) Text(label(zh, "请检查网关的视频模型配置，再准备新草稿。",
          "Check the gateway video model and prepare a new draft."), style = MaterialTheme.typography.bodySmall)
      }
      val error = if (confirmationFailed) label(zh, "提交未完成，请检查当前草稿后重试。",
        "Submission failed. Review the current draft and try again.") else item.error
      error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
  }
}

@Composable
internal fun GeneratedVideoSheet(
  item: GeneratedMediaItem,
  conversationId: String,
  access: GeneratedMediaAccess,
  onClose: () -> Unit,
) {
  val zh = LocalConfiguration.current.locales[0].language == "zh"
  val context = LocalContext.current
  val export = rememberPreviewExport("video/mp4")
  val title = item.title.orEmpty().ifBlank { label(zh, "视频", "Video") }
  MobilePreviewSheet(onClose, Modifier.testTag("video-player-drawer")) {
    PreviewHeader(title, onClose, "video-player-close") { dismiss ->
      DropdownMenuItem(text = { Text(stringResource(R.string.preview_download)) }, onClick = {
        dismiss()
        val safeName = title.filterNot { it == '/' || it == '\\' || it.isISOControl() }.take(100).ifBlank { "video" }
        export("$safeName.mp4") { target ->
          val file = File.createTempFile("video-export-", ".mp4", context.cacheDir)
          try {
            access.download(conversationId, item, file)
            file.inputStream().use { it.copyTo(target) }
          } finally { file.delete() }
        }
      })
    }
    GeneratedVideoPlayer(item, conversationId, access)
  }
}

@Composable
private fun GeneratedVideoPlayer(
  item: GeneratedMediaItem,
  conversationId: String,
  access: GeneratedMediaAccess,
) {
  val zh = LocalConfiguration.current.locales[0].language == "zh"
  var retry by remember(item.id) { mutableIntStateOf(0) }
  var failed by remember(conversationId, item.id, retry) { mutableStateOf(false) }
  var uri by remember(conversationId, item.id, retry) { mutableStateOf<Uri?>(null) }
  LaunchedEffect(access, conversationId, item.id, retry) {
    try {
      uri = Uri.parse(access.playbackUrl(item.kind, conversationId, item.id))
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      failed = true
    }
  }

  Column(Modifier.fillMaxWidth().testTag("generated-video-player-${item.id}"),
    verticalArrangement = Arrangement.spacedBy(6.dp)) {
    val source = uri
    when {
      failed -> {
        Text(label(zh, "无法播放这份媒体", "Unable to play this media"), color = MaterialTheme.colorScheme.error)
        TextButton(onClick = { retry++ }) { Text(label(zh, "重试", "Try again")) }
      }
      source == null -> CircularProgressIndicator(Modifier.size(32.dp).align(Alignment.CenterHorizontally))
      else -> PreviewVideo(source, Modifier.fillMaxWidth().aspectRatio(if (item.ratio == "9:16") 1f else 16f / 9f),
        autoplay = true, onError = { failed = true })
    }
  }
}

@Composable
internal fun PreviewVideo(file: File, modifier: Modifier, autoplay: Boolean = false, onError: () -> Unit) {
  PreviewVideo(Uri.fromFile(file), modifier, autoplay, onError)
}

@Composable
internal fun PreviewVideo(uri: Uri, modifier: Modifier, autoplay: Boolean = false, onError: () -> Unit) {
  androidx.compose.runtime.key(uri) {
    AndroidView(
      factory = { context ->
        VideoView(context).apply {
          setMediaController(MediaController(context).also { it.setAnchorView(this) })
          setOnErrorListener { _, _, _ -> onError(); true }
          setOnPreparedListener { if (autoplay) start() else seekTo(1) }
          setVideoURI(uri)
        }
      },
      onRelease = { it.stopPlayback() },
      modifier = modifier,
    )
  }
}

private fun label(zh: Boolean, chinese: String, english: String) = if (zh) chinese else english
private fun price(value: Double) = String.format(Locale.ROOT, "%.2f", value)
private fun mediaTime(seconds: Int) = "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"

@Composable
internal fun GeneratedMediaRows(items: List<GeneratedMediaItem>, submitting: Boolean, failedDraftId: String?,
  onPlay: (GeneratedMediaItem) -> Unit, onConfirm: (GeneratedMediaItem) -> Unit,
  conversationId: String? = null, activeMusic: MusicTrack? = null,
  onOpen: (GeneratedMediaItem) -> Unit = onPlay,
  onMusicBounds: (Rect?) -> Unit = {}) {
  Column(Modifier.fillMaxWidth().padding(top = 6.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    for (item in items) {
      androidx.compose.runtime.key(item.kind, item.id) {
        val music = activeMusic?.takeIf { item.kind == GeneratedMediaKind.Music && it.id == item.id && it.conversationId == conversationId }
        val trackBounds = if (music == null) Modifier else {
          DisposableEffect(music.key) { onDispose { onMusicBounds(null) } }
          Modifier.onGloballyPositioned { onMusicBounds(it.boundsInWindow()) }
        }
        val alignment = if (item.kind == GeneratedMediaKind.Music) Alignment.Start else Alignment.End
        Box(Modifier.fillMaxWidth(CHAT_MESSAGE_WIDTH).align(alignment),
          contentAlignment = if (item.kind == GeneratedMediaKind.Music) Alignment.TopStart else Alignment.TopEnd) {
          GeneratedMediaCard(item, submitting, failedDraftId == item.id, { onPlay(item) }, { onConfirm(item) }, music,
            onOpen = if (item.state == "completed") ({ onOpen(item) }) else null,
            modifier = trackBounds)
        }
      }
    }
  }
}

internal class GeneratedMediaChatState(initialItems: List<GeneratedMediaItem> = emptyList()) {
  var items by mutableStateOf(initialItems)
    private set
  var submitting by mutableStateOf(false)
    private set
  var failedDraftId by mutableStateOf<String?>(null)
    private set
  var presentedVideo by mutableStateOf<GeneratedMediaItem?>(null)
  private var videoRevision = 0

  suspend fun observe(access: GeneratedMediaAccess, scope: GeneratedMediaScope, busy: Boolean) {
    while (true) {
      kotlinx.coroutines.coroutineScope {
        val revision = videoRevision
        launch { refresh(access, scope, GeneratedMediaKind.Music, revision) }
        launch { refresh(access, scope, GeneratedMediaKind.Video, revision) }
      }
      delay(if (busy || items.any { it.active }) 3_000L else 20_000L)
    }
  }

  suspend fun confirm(access: GeneratedMediaAccess, scope: GeneratedMediaScope, card: GeneratedMediaItem) {
    if (submitting || !card.isDraft || !card.canConfirm) return
    submitting = true
    failedDraftId = null
    val revision = ++videoRevision
    try {
      val job = access.confirm(scope, card)
      replace(access, scope, GeneratedMediaKind.Video,
        items.filter { it.kind == GeneratedMediaKind.Video && !it.isDraft && it.id != job.id } + job)
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      failedDraftId = card.id
    } finally {
      submitting = false
    }
    refresh(access, scope, GeneratedMediaKind.Video, revision)
  }

  private suspend fun refresh(access: GeneratedMediaAccess, scope: GeneratedMediaScope, kind: GeneratedMediaKind, revision: Int) {
    try {
      val result = access.list(scope, kind)
      if (kind != GeneratedMediaKind.Video || (!submitting && revision == videoRevision)) replace(access, scope, kind, result)
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      // A gateway can support either generation route independently.
    }
  }

  private fun replace(access: GeneratedMediaAccess, scope: GeneratedMediaScope, kind: GeneratedMediaKind,
    replacements: List<GeneratedMediaItem>) {
    val incomingIds = replacements.mapTo(mutableSetOf()) { it.id }
    items = (items.filter { it.kind != kind || !it.isDraft && it.id !in incomingIds } + replacements)
      .sortedWith(compareBy({ it.order }, { it.id }))
    access.cache(scope, items)
  }
}
