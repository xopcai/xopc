package ai.xopc.mobile.ui.main

import android.media.MediaPlayer
import android.widget.MediaController
import android.widget.VideoView
import java.io.File
import java.util.Locale

import ai.xopc.mobile.gateway.GeneratedMediaAccess
import ai.xopc.mobile.gateway.GeneratedMediaItem
import ai.xopc.mobile.gateway.GeneratedMediaKind

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
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
) {
  val zh = LocalConfiguration.current.locales[0].language == "zh"
  var details by remember(item.id) { mutableStateOf(false) }
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
  val duration = item.duration?.let {
    when {
      it < 0 -> label(zh, "自动时长", "Auto duration")
      item.kind == GeneratedMediaKind.Music -> mediaTime(it)
      else -> label(zh, "$it 秒", "$it s")
    }
  }
  val metadata = listOfNotNull(status, item.version?.let { label(zh, "第 $it 版", "Version $it") }, duration,
    item.resolution, item.ratio?.takeUnless { it == "adaptive" }).joinToString(" · ")
  Surface(modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth().testTag("generated-media-card-${item.id}"),
    shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.secondaryContainer) {
          Box(Modifier.size(42.dp), contentAlignment = Alignment.Center) {
            Text(if (item.kind == GeneratedMediaKind.Music) "♫" else "▣", color = MaterialTheme.colorScheme.onSecondaryContainer,
              style = MaterialTheme.typography.titleLarge)
          }
        }
        Column(Modifier.weight(1f)) {
          Text(item.title ?: kindLabel, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
          Text(metadata, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (item.state == "completed") {
          val play = label(zh, "播放", "Play")
          FilledTonalIconButton(onClick = onPlay, modifier = Modifier.testTag("generated-media-play-${item.id}")
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
      item.prompt?.let { prompt ->
        TextButton(onClick = { details = !details }) {
          Text(if (details) label(zh, "收起创作详情", "Hide details") else label(zh, "创作详情", "Details"))
        }
        if (details) Text(prompt, style = MaterialTheme.typography.bodyMedium)
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun GeneratedMediaPlayer(
  item: GeneratedMediaItem,
  conversationId: String,
  access: GeneratedMediaAccess,
  onDismiss: () -> Unit,
) {
  val context = LocalContext.current
  val configuration = LocalConfiguration.current
  val zh = configuration.locales[0].language == "zh"
  var retry by remember(item.id) { mutableIntStateOf(0) }
  var failed by remember(item.id, retry) { mutableStateOf(false) }
  var file by remember(item.id, retry) { mutableStateOf<File?>(null) }
  LaunchedEffect(access, conversationId, item.id, retry) {
    var destination: File? = null
    try {
      destination = File.createTempFile("generated-", item.kind.extension, context.cacheDir)
      access.download(conversationId, item, destination)
      file = destination
      kotlinx.coroutines.awaitCancellation()
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      failed = true
    } finally {
      destination?.delete()
    }
  }

  ModalBottomSheet(onDismissRequest = onDismiss) {
    Column(Modifier.fillMaxWidth().heightIn(max = (configuration.screenHeightDp * 0.72f).dp)
      .verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 28.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(item.title ?: if (item.kind == GeneratedMediaKind.Music) label(zh, "音乐", "Music") else label(zh, "视频", "Video"),
        style = MaterialTheme.typography.headlineSmall)
      val local = file
      when {
        failed -> {
          Text(label(zh, "无法播放这份媒体", "Unable to play this media"), color = MaterialTheme.colorScheme.error)
          TextButton(onClick = { retry++ }) { Text(label(zh, "重试", "Try again")) }
        }
        local == null -> CircularProgressIndicator(Modifier.size(32.dp).align(Alignment.CenterHorizontally))
        item.kind == GeneratedMediaKind.Music -> GeneratedAudio(local, item.lyrics, zh) { failed = true }
        else -> AndroidView(
          factory = { ctx ->
            VideoView(ctx).apply {
              setMediaController(MediaController(ctx).also { it.setAnchorView(this) })
              setOnErrorListener { _, _, _ -> failed = true; true }
              setOnPreparedListener { start() }
              setVideoPath(local.absolutePath)
            }
          },
          onRelease = { it.stopPlayback() },
          modifier = Modifier.fillMaxWidth().aspectRatio(if (item.ratio == "9:16") 1f else 16f / 9f),
        )
      }
    }
  }
}

@Composable
private fun GeneratedAudio(file: File, lyrics: String?, zh: Boolean, onError: () -> Unit) {
  var native by remember(file) { mutableStateOf<MediaPlayer?>(null) }
  var playing by remember(file) { mutableStateOf(false) }
  var duration by remember(file) { mutableIntStateOf(0) }
  var position by remember(file) { mutableFloatStateOf(0f) }
  var seek by remember(file) { mutableStateOf<Float?>(null) }
  var showLyrics by remember(file) { mutableStateOf(false) }
  DisposableEffect(file) {
    val player = MediaPlayer()
    try {
      player.setOnErrorListener { _, _, _ -> onError(); true }
      player.setOnPreparedListener {
        duration = it.duration.coerceAtLeast(0)
        native = it
        it.start()
        playing = true
      }
      player.setOnCompletionListener { playing = false; position = duration.toFloat() }
      player.setDataSource(file.absolutePath)
      player.prepareAsync()
    } catch (_: Exception) { onError() }
    onDispose { player.release() }
  }
  LaunchedEffect(native, playing) {
    if (!playing) return@LaunchedEffect
    val player = native ?: return@LaunchedEffect
    while (true) { position = player.currentPosition.toFloat(); delay(250) }
  }
  Slider(value = (seek ?: position).coerceIn(0f, duration.toFloat()),
    onValueChange = { seek = it }, enabled = duration > 0, valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
    onValueChangeFinished = {
      seek?.let { target ->
        runCatching { native?.seekTo(target.toInt()) }.onFailure { onError() }
        position = target
      }
      seek = null
    })
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(mediaTime((seek ?: position).toInt() / 1000), style = MaterialTheme.typography.labelMedium)
    Text(mediaTime(duration / 1000), style = MaterialTheme.typography.labelMedium)
  }
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Button(enabled = native != null, onClick = {
      runCatching {
        if (playing) native?.pause() else native?.start()
        playing = !playing
      }.onFailure { onError() }
    }) { Text(if (playing) label(zh, "暂停", "Pause") else label(zh, "播放", "Play")) }
    if (lyrics != null) TextButton(onClick = { showLyrics = !showLyrics }) {
      Text(if (showLyrics) label(zh, "收起歌词", "Hide lyrics") else label(zh, "歌词", "Lyrics"))
    }
  }
  if (showLyrics && lyrics != null) Text(lyrics, style = MaterialTheme.typography.bodyLarge)
}

private fun label(zh: Boolean, chinese: String, english: String) = if (zh) chinese else english
private fun price(value: Double) = String.format(Locale.ROOT, "%.2f", value)
private fun mediaTime(seconds: Int) = "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"

@Composable
internal fun GeneratedMediaRows(items: List<GeneratedMediaItem>, submitting: Boolean, failedDraftId: String?,
  onPlay: (GeneratedMediaItem) -> Unit, onConfirm: (GeneratedMediaItem) -> Unit) {
  Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    for (item in items) {
      androidx.compose.runtime.key(item.kind, item.id) {
        GeneratedMediaCard(item, submitting, failedDraftId == item.id, { onPlay(item) }, { onConfirm(item) })
      }
    }
  }
}

internal class GeneratedMediaChatState {
  var items by mutableStateOf(emptyList<GeneratedMediaItem>())
    private set
  var submitting by mutableStateOf(false)
    private set
  var failedDraftId by mutableStateOf<String?>(null)
    private set
  var playing by mutableStateOf<GeneratedMediaItem?>(null)
  private var videoRevision = 0

  suspend fun observe(access: GeneratedMediaAccess, conversationId: String, busy: Boolean) {
    while (true) {
      kotlinx.coroutines.coroutineScope {
        val revision = videoRevision
        launch { refresh(access, conversationId, GeneratedMediaKind.Music, revision) }
        launch { refresh(access, conversationId, GeneratedMediaKind.Video, revision) }
      }
      delay(if (busy || items.any { it.active }) 3_000L else 20_000L)
    }
  }

  suspend fun confirm(access: GeneratedMediaAccess, conversationId: String, card: GeneratedMediaItem) {
    if (submitting || !card.isDraft || !card.canConfirm) return
    submitting = true
    failedDraftId = null
    val revision = ++videoRevision
    try {
      val job = access.confirm(conversationId, card)
      replace(GeneratedMediaKind.Video,
        items.filter { it.kind == GeneratedMediaKind.Video && !it.isDraft && it.id != job.id } + job)
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      failedDraftId = card.id
    } finally {
      submitting = false
    }
    refresh(access, conversationId, GeneratedMediaKind.Video, revision)
  }

  private suspend fun refresh(access: GeneratedMediaAccess, conversationId: String, kind: GeneratedMediaKind, revision: Int) {
    try {
      val result = access.list(conversationId, kind)
      if (kind != GeneratedMediaKind.Video || (!submitting && revision == videoRevision)) replace(kind, result)
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      // A gateway can support either generation route independently.
    }
  }

  private fun replace(kind: GeneratedMediaKind, replacements: List<GeneratedMediaItem>) {
    items = (items.filterNot { it.kind == kind } + replacements)
      .sortedWith(compareBy({ it.order }, { it.id }))
  }
}
