package ai.xopc.mobile.ui.main

import android.media.MediaPlayer
import android.net.Uri
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
import ai.xopc.mobile.theme.themedCorners

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos

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
    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
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
          Column(Modifier.weight(1f)) {
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
        } else if (item.active) {
          GeneratedMediaActivity(item.kind, item.state == "queued" || item.state == "submitted", item.error != null)
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
        estimate?.let { Text(it, modifier = Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall) }
        Button(onClick = onConfirm, enabled = item.canConfirm && !submitting,
          modifier = Modifier.testTag("generated-video-confirm-${item.id}")) {
          Text(if (submitting) label(zh, "正在提交", "Submitting") else label(zh, "确认生成", "Generate video"))
        }
        if (!item.canConfirm) Text(label(zh, "请检查网关的视频模型配置，再准备新草稿。",
          "Check the gateway video model and prepare a new draft."), modifier = Modifier.fillMaxWidth(),
          style = MaterialTheme.typography.bodySmall)
      }
      val error = if (confirmationFailed) label(zh, "提交未完成，请检查当前草稿后重试。",
        "Submission failed. Review the current draft and try again.") else item.error
      error?.let { Text(it, modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
  }
}

private val generationWaveform = listOf(6, 10, 16, 22, 17, 12, 7)

@Composable
private fun GeneratedMediaActivity(kind: GeneratedMediaKind, waiting: Boolean, paused: Boolean) {
  val motionAllowed = rememberMotionAllowed()
  val cycle = if (motionAllowed && !paused) {
    val period = if (kind == GeneratedMediaKind.Music) 1650 else 3000
    rememberInfiniteTransition(label = "media generation").animateFloat(
      initialValue = 0f, targetValue = 1f,
      animationSpec = infiniteRepeatable(tween(if (waiting) period * 3 / 2 else period, easing = LinearEasing)),
      label = "generation phase",
    )
  } else null
  val palette = LocalChatColors.current
  Canvas(Modifier.size(width = 64.dp, height = 34.dp)) {
    drawRoundRect(palette.action.copy(alpha = 0.07f), cornerRadius = CornerRadius(8.dp.toPx()))
    val phase = cycle?.value
    if (kind == GeneratedMediaKind.Music) {
      val spacing = 6.dp.toPx()
      val barWidth = 2.5.dp.toPx()
      generationWaveform.forEachIndexed { index, height ->
        val wave = phase?.let { (1f - cos(it * 2 * PI - index * 0.8).toFloat()) / 2 } ?: 0.68f
        val barHeight = height.dp.toPx() * (0.44f + 0.56f * wave)
        drawRoundRect(palette.action.copy(alpha = 0.34f + 0.46f * wave),
          topLeft = Offset(center.x + (index - 3) * spacing - barWidth / 2, center.y - barHeight / 2),
          size = Size(barWidth, barHeight), cornerRadius = CornerRadius(barWidth / 2))
      }
    } else {
      val frameWidth = 13.dp.toPx()
      val frameHeight = 10.dp.toPx()
      repeat(3) { index ->
        val light = phase?.let { (1f + cos((it - index / 3f) * 2 * PI).toFloat()) / 2 } ?: if (index == 1) 1f else 0f
        drawRoundRect(palette.action.copy(alpha = 0.14f + 0.47f * light),
          topLeft = Offset(center.x + (index - 1) * 16.dp.toPx() - frameWidth / 2, center.y - frameHeight / 2),
          size = Size(frameWidth, frameHeight), cornerRadius = CornerRadius(2.dp.toPx()))
      }
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
    GeneratedVideoPlayer(
      item,
      conversationId,
      access,
      Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
    )
  }
}

@Composable
private fun GeneratedVideoPlayer(
  item: GeneratedMediaItem,
  conversationId: String,
  access: GeneratedMediaAccess,
  modifier: Modifier = Modifier,
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

  Box(modifier.testTag("generated-video-player-${item.id}"), contentAlignment = Alignment.Center) {
    val source = uri
    when {
      failed -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label(zh, "无法播放这份媒体", "Unable to play this media"), color = MaterialTheme.colorScheme.error)
        TextButton(onClick = { retry++ }) { Text(label(zh, "重试", "Try again")) }
      }
      source == null -> CircularProgressIndicator(Modifier.size(32.dp))
      else -> PreviewVideo(
        source,
        Modifier.fillMaxSize(),
        autoplay = true,
        initialAspectRatio = parseVideoAspectRatio(item.ratio),
        onError = { failed = true },
      )
    }
  }
}

internal fun parseVideoAspectRatio(ratio: String?): Float? {
  val parts = ratio?.trim()?.split(':') ?: return null
  if (parts.size != 2) return null
  val width = parts[0].toFloatOrNull() ?: return null
  val height = parts[1].toFloatOrNull() ?: return null
  return if (width > 0f && height > 0f) width / height else null
}

private fun fitVideoSize(maxWidth: Dp, maxHeight: Dp, aspectRatio: Float): Pair<Dp, Dp> {
  val safeRatio = aspectRatio.takeIf { it.isFinite() && it > 0f } ?: (16f / 9f)
  val width = minOf(maxWidth, maxHeight * safeRatio)
  val height = width / safeRatio
  return width to height
}

private fun videoPlaybackTime(milliseconds: Int): String {
  val seconds = milliseconds.coerceAtLeast(0) / 1000
  return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}

@Composable
internal fun PreviewVideo(
  file: File,
  modifier: Modifier,
  autoplay: Boolean = false,
  initialAspectRatio: Float? = null,
  onError: () -> Unit,
) {
  PreviewVideo(Uri.fromFile(file), modifier, autoplay, initialAspectRatio, onError)
}

@Composable
internal fun PreviewVideo(
  uri: Uri,
  modifier: Modifier,
  autoplay: Boolean = false,
  initialAspectRatio: Float? = null,
  onError: () -> Unit,
) {
  androidx.compose.runtime.key(uri) {
    var videoView by remember { mutableStateOf<VideoView?>(null) }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var aspectRatio by remember { mutableFloatStateOf(initialAspectRatio ?: (16f / 9f)) }
    var prepared by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var completed by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(false) }
    var durationMs by remember { mutableIntStateOf(0) }
    var positionMs by remember { mutableIntStateOf(0) }
    var draggingMs by remember { mutableStateOf<Float?>(null) }
    val latestOnError by rememberUpdatedState(onError)

    fun togglePlayback() {
      val view = videoView ?: return
      if (!prepared) return
      if (playing) {
        runCatching { view.pause() }
        playing = false
      } else {
        if (completed) {
          completed = false
          positionMs = 0
          runCatching { view.seekTo(0) }
        }
        runCatching { view.start() }
        playing = true
      }
    }
    val latestToggle by rememberUpdatedState(::togglePlayback)

    LaunchedEffect(playing) {
      while (playing) {
        val current = runCatching { videoView?.currentPosition }.getOrNull()
        if (current != null && draggingMs == null) {
          positionMs = current.coerceIn(0, durationMs.coerceAtLeast(current))
        }
        delay(200L)
      }
    }

    val chat = LocalChatColors.current
    val colors = MaterialTheme.colorScheme
    val seekLabel = stringResource(R.string.music_seek)
    val displayMs = (draggingMs?.toInt() ?: positionMs).coerceIn(0, durationMs.coerceAtLeast(0))

    Column(
      modifier = modifier,
      verticalArrangement = Arrangement.spacedBy(12.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      BoxWithConstraints(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
        val (videoWidth, videoHeight) = fitVideoSize(maxWidth, maxHeight, aspectRatio)
        Box(
          Modifier.size(videoWidth, videoHeight).clip(themedCorners(16)).background(Color.Black),
          contentAlignment = Alignment.Center,
        ) {
          AndroidView(
            factory = { context ->
              VideoView(context).apply {
                videoView = this
                setOnClickListener { latestToggle() }
                setOnErrorListener { _, _, _ ->
                  playing = false
                  latestOnError()
                  true
                }
                setOnPreparedListener { mp ->
                  mediaPlayer = mp
                  val level = if (muted) 0f else 1f
                  runCatching { mp.setVolume(level, level) }
                  if (mp.videoWidth > 0 && mp.videoHeight > 0) {
                    aspectRatio = mp.videoWidth.toFloat() / mp.videoHeight.toFloat()
                  }
                  durationMs = mp.duration.coerceAtLeast(0)
                  prepared = true
                  if (autoplay) {
                    start()
                    playing = true
                    completed = false
                  } else {
                    seekTo(1)
                    playing = false
                  }
                }
                setOnCompletionListener {
                  playing = false
                  completed = true
                  if (durationMs > 0) positionMs = durationMs
                }
                setVideoURI(uri)
              }
            },
            onRelease = {
              it.stopPlayback()
              if (videoView === it) videoView = null
              mediaPlayer = null
            },
            modifier = Modifier.fillMaxSize(),
          )
        }
      }

      Surface(
        modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth().testTag("video-player-controls"),
        shape = themedCorners(18),
        color = chat.card,
      ) {
        Column(
          Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
          verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
          ) {
            Text(
              videoPlaybackTime(displayMs),
              style = MaterialTheme.typography.labelSmall,
              color = colors.onSurfaceVariant,
              modifier = Modifier.widthIn(min = 36.dp),
            )
            Slider(
              value = displayMs.toFloat(),
              onValueChange = { draggingMs = it },
              onValueChangeFinished = {
                val target = (draggingMs ?: displayMs.toFloat()).toInt().coerceIn(0, durationMs.coerceAtLeast(0))
                draggingMs = null
                positionMs = target
                if (durationMs > 0 && target < durationMs) completed = false
                runCatching { videoView?.seekTo(target) }
              },
              valueRange = 0f..durationMs.coerceAtLeast(1).toFloat(),
              enabled = prepared && durationMs > 0,
              colors = SliderDefaults.colors(
                thumbColor = chat.action,
                activeTrackColor = chat.action,
                inactiveTrackColor = colors.outlineVariant,
              ),
              modifier = Modifier.weight(1f).semantics { contentDescription = seekLabel }.testTag("video-player-progress"),
            )
            Text(
              if (durationMs > 0) videoPlaybackTime(durationMs) else "–:–",
              style = MaterialTheme.typography.labelSmall,
              color = colors.onSurfaceVariant,
              modifier = Modifier.widthIn(min = 36.dp),
            )
          }
          Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
          ) {
            FilledTonalIconButton(
              onClick = { togglePlayback() },
              enabled = prepared,
              modifier = Modifier.size(44.dp).testTag("video-player-toggle"),
              colors = IconButtonDefaults.filledTonalIconButtonColors(
                containerColor = chat.action,
                contentColor = chat.onAction,
              ),
            ) {
              Icon(
                painterResource(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
                stringResource(if (playing) R.string.music_pause else R.string.music_play),
                Modifier.size(22.dp),
              )
            }
            IconButton(
              onClick = {
                muted = !muted
                val level = if (muted) 0f else 1f
                runCatching { mediaPlayer?.setVolume(level, level) }
              },
              modifier = Modifier.size(44.dp).testTag("video-player-mute"),
            ) {
              Icon(
                painterResource(if (muted) R.drawable.action_speaker_off else R.drawable.action_speaker),
                stringResource(if (muted) R.string.voice_unmute else R.string.voice_mute),
                Modifier.size(20.dp),
              )
            }
          }
        }
      }
    }
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
        Box(Modifier.fillMaxWidth(CHAT_MESSAGE_WIDTH).align(Alignment.Start),
          contentAlignment = Alignment.TopStart) {
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
