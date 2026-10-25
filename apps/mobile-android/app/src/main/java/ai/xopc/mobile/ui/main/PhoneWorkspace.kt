package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.*
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import androidx.activity.compose.BackHandler
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.min

internal data class PhoneUiState(val summary: PhoneSummary? = null, val live: PhoneState? = null,
  val busy: Boolean = false, val error: Boolean = false, val playing: Boolean = false, val fallback: Boolean = false,
  val frame: PhoneFrame? = null, val width: Int = 1, val height: Int = 2, val geometry: Int = 0) {
  val canControl get() = summary?.access == "control" && live?.mode == "control" && (live.owner != "human" || live.ownControl)
}
internal class PhoneWorkspaceController(private val repository: PhoneRepository, private val conversationId: String,
  private val scope: CoroutineScope) {
  private val mutable = MutableStateFlow(PhoneUiState())
  val state = mutable.asStateFlow()
  private var active = false
  private var visible = false
  private var generation = 0
  private var operations = 0
  private var surface: Surface? = null
  private var video: PhoneVideo? = null
  private var streamKey = ""
  private var streamRevision = 0
  private var heartbeatAt = 0L
  suspend fun observe(pageVisible: () -> Boolean) {
    active = true
    try {
      if (!repository.supported()) return
      while (currentCoroutineContext().isActive) {
        val next = pageVisible()
        if (visible && !next) leave()
        visible = next
        refresh()
        delay(if (visible) 1200 else 4000)
      }
    } finally { active = false; visible = false; leave() }
  }
  private suspend fun refresh() {
    if (mutable.value.busy) return
    val operationRevision = operations
    val revision = generation
    try {
      val summary = repository.summary(conversationId)
      if (revision != generation || operationRevision != operations || !active) return
      if (summary.binding != mutable.value.summary?.binding) { leave(); mutable.value = PhoneUiState(summary = summary) }
      else mutable.value = mutable.value.copy(summary = summary)
      if (!summary.available || summary.access == "none") { leave(); mutable.value = PhoneUiState(summary = summary); return }
      if (!visible || summary.binding == null) return
      val live = repository.state(conversationId)
      if (revision != generation || operationRevision != operations || !active || !visible) return
      mutable.value = mutable.value.copy(live = live)
      if (live == null) return
      if (live.ownControl && !mutable.value.busy && System.currentTimeMillis() - heartbeatAt > 4000) {
        heartbeatAt = System.currentTimeMillis(); commandNow("heartbeat")
      }
      ensureVideo()
      if (mutable.value.fallback && touchStart == null) {
        val frame = repository.frame(summary.binding)
        if (revision == generation && operationRevision == operations && touchStart == null && active && visible && mutable.value.summary?.binding == summary.binding) mutable.value = mutable.value.copy(frame = frame)
      }
    } catch (cancelled: CancellationException) { throw cancelled }
    catch (_: Exception) { if (revision == generation && operationRevision == operations) { leave(); mutable.value = mutable.value.copy(live = null, frame = null, error = true) } }
  }
  fun setSurface(next: Surface?) { surface = next; if (next == null) stopVideo() else scope.launch { ensureVideo() } }
  private fun stopVideo() { streamRevision++; video?.close(); video = null; streamKey = ""; mutable.value = mutable.value.copy(playing = false, geometry = 0) }
  private suspend fun ensureVideo() {
    val current = mutable.value; val binding = current.summary?.binding ?: return; val live = current.live ?: return
    val target = surface ?: return
    if (!active || !visible || live.restore || current.fallback) return
    val key = "${binding.sessionId}:${if (live.ownControl) live.epoch else 0}"
    if (key == streamKey) return
    stopVideo(); streamKey = key
    val revision = generation
    val mediaRevision = streamRevision
    try {
      val (url, ticket) = repository.video(binding, live)
      if (revision != generation || !active || !visible || surface !== target || mediaRevision != streamRevision) return
      val next = PhoneVideo(target, if (live.ownControl) live.epoch else 0, { width, height, geometry -> scope.launch {
        if (streamKey == key && mediaRevision == streamRevision) mutable.value = mutable.value.copy(width = width, height = height, geometry = geometry)
      } }, { scope.launch { if (streamKey == key && mediaRevision == streamRevision) mutable.value = mutable.value.copy(playing = true, error = false) } }, {
        scope.launch { if (streamKey == key && mediaRevision == streamRevision) { stopVideo(); mutable.value = mutable.value.copy(fallback = true) } }
      })
      video = next
      withContext(Dispatchers.IO) { next.open(url, ticket) }
    } catch (cancelled: CancellationException) { throw cancelled }
    catch (_: Exception) { if (revision == generation) { stopVideo(); mutable.value = mutable.value.copy(fallback = true) } }
  }
  fun command(op: String, action: JSONObject? = null) { scope.launch { commandNow(op, action) } }
  private suspend fun commandNow(op: String, action: JSONObject? = null) {
    val current = mutable.value; val binding = current.summary?.binding ?: return; val live = current.live ?: return
    if (!active || !visible || current.busy) return
    val revision = generation
    if (op != "heartbeat") { operations++; video?.pointer("cancel", 0, 0); touchStart = null; mutable.value = current.copy(busy = true, error = false) }
    try {
      val result = withContext(NonCancellable) { repository.command(binding, live, op, action, current.geometry.takeIf { current.playing }, current.frame?.seq) }
      if (revision != generation || !visible || !active || !currentCoroutineContext().isActive) {
        if (result.ownControl) withContext(NonCancellable) { repository.command(binding, result, "release") }
        return
      }
      mutable.value = mutable.value.copy(live = result)
      if (result.sessionId != binding.sessionId) { stopVideo(); mutable.value = mutable.value.copy(summary = repository.summary(conversationId)) }
      ensureVideo()
    } catch (cancelled: CancellationException) {
      // A completed takeover with a cancelled response is bounded by the server lease.
      throw cancelled
    } catch (_: Exception) { if (revision == generation) mutable.value = mutable.value.copy(error = true) }
    finally { if (revision == generation) mutable.value = mutable.value.copy(busy = false) }
  }
  private var touchStart: Pair<Int, Int>? = null
  private var touchAt = 0L
  fun pointer(phase: String, x: Int, y: Int) {
    val current = mutable.value
    if (!visible || !active || current.live?.ownControl != true || current.busy) return
    if (current.playing) { video?.pointer(phase, x, y); return }
    if (phase == "cancel") { touchStart = null; return }
    if (phase == "down") { touchStart = x to y; touchAt = System.currentTimeMillis() }
    if (phase != "up") return
    val start = touchStart ?: return
    touchStart = null
    if (current.frame?.let { System.currentTimeMillis() - it.capturedAt < 5000 } != true) return
    val duration = (System.currentTimeMillis() - touchAt).coerceIn(100, 3000)
    val action = if (abs(x - start.first) + abs(y - start.second) > 25)
      JSONObject().put("type", "swipe").put("start", JSONArray(listOf(start.first, start.second))).put("end", JSONArray(listOf(x, y))).put("durationMs", duration)
    else JSONObject().put("type", if (duration >= 500) "longPress" else "tap").put("point", JSONArray(listOf(x, y))).put("durationMs", duration)
    command("input", action)
  }
  fun retry() { stopVideo(); mutable.value = mutable.value.copy(fallback = false, frame = null, error = false); scope.launch { refresh() } }
  fun leave() {
    generation++; touchStart = null; val old = mutable.value; stopVideo()
    mutable.value = mutable.value.copy(live = null, frame = null, fallback = false, busy = false)
    val binding = old.summary?.binding; val live = old.live
    if (binding != null && live?.ownControl == true) scope.launch(NonCancellable) { runCatching { repository.command(binding, live, "release") } }
  }
}

@Composable
internal fun rememberPhoneWorkspace(repository: PhoneRepository?, conversationId: String?, gatewayId: String?,
  active: Boolean, pageVisible: Boolean): PhoneWorkspaceController? {
  val scope = rememberCoroutineScope()
  val lifecycle = LocalLifecycleOwner.current
  val controller = remember(repository, conversationId, gatewayId) {
    if (repository != null && conversationId != null) PhoneWorkspaceController(repository, conversationId, scope) else null
  }
  val visible by rememberUpdatedState(pageVisible)
  LaunchedEffect(controller, lifecycle, active) {
    if (active) lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { controller?.observe { visible } }
  }
  DisposableEffect(controller) { onDispose { controller?.leave() } }
  return controller
}

@Composable
internal fun phoneWorkspaceState(controller: PhoneWorkspaceController?): PhoneUiState {
  return controller?.state?.collectAsState()?.value ?: PhoneUiState()
}

@Composable
internal fun PhoneConversationPager(controller: PhoneWorkspaceController?, phonePage: Boolean, onPage: (Boolean) -> Unit,
  chat: @Composable () -> Unit) {
  val pager = rememberPagerState { 2 }
  val scope = rememberCoroutineScope()
  val ui = controller?.state?.collectAsState()?.value ?: PhoneUiState()
  LaunchedEffect(phonePage) { pager.animateScrollToPage(if (phonePage) 1 else 0) }
  LaunchedEffect(pager) { snapshotFlow { pager.currentPage }.collect { onPage(it == 1) } }
  BackHandler(phonePage) { onPage(false) }
  HorizontalPager(pager, beyondViewportPageCount = 1, userScrollEnabled = ui.summary?.available == true && ui.live?.ownControl != true,
    modifier = Modifier.fillMaxSize()) { page ->
    if (page == 0) chat() else PhoneWorkspaceContent(ui, onReturn = { onPage(false) },
      onCommand = { op, action -> controller?.command(op, action) }, onPointer = { phase, x, y -> controller?.pointer(phase, x, y) }, onRetry = { controller?.retry() },
      video = { modifier -> PhoneVideoSurface(ui, modifier) { controller?.setSurface(it) } })
  }
}

@Composable
private fun PhoneVideoSurface(ui: PhoneUiState, modifier: Modifier, onSurface: (Surface?) -> Unit) {
  val currentCallback by rememberUpdatedState(onSurface)
  var surface by remember { mutableStateOf<Surface?>(null) }
  DisposableEffect(Unit) { onDispose { currentCallback(null); surface?.release() } }
  AndroidView(modifier = modifier, factory = { context -> TextureView(context).apply {
    surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
        surface = Surface(texture); currentCallback(surface)
      }
      override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {}
      override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean { currentCallback(null); surface?.release(); surface = null; return true }
      override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {}
    }
  } }, update = { it.alpha = if (ui.playing) 1f else 0f })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhoneWorkspaceContent(ui: PhoneUiState, onReturn: () -> Unit, onCommand: (String, JSONObject?) -> Unit,
  onPointer: (String, Int, Int) -> Unit, onRetry: () -> Unit, video: @Composable (Modifier) -> Unit) {
  var more by remember { mutableStateOf(false) }
  var textOpen by remember { mutableStateOf(false) }
  var draft by remember { mutableStateOf("") }
  var stopOpen by remember { mutableStateOf(false) }
  var stopSession by remember { mutableStateOf("") }
  LaunchedEffect(ui.live?.epoch, ui.live?.ownControl, ui.summary?.binding) { textOpen = false; draft = ""; more = false }
  LaunchedEffect(ui.summary?.binding) { stopOpen = false }
  Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = onReturn, modifier = Modifier.size(48.dp).testTag("phone-return")) { Text("‹", style = MaterialTheme.typography.headlineMedium) }
      Column(Modifier.weight(1f)) {
        Text(ui.summary?.name.orEmpty(), style = MaterialTheme.typography.titleMedium, maxLines = 1)
        Text(stringResource(when {
          ui.busy -> R.string.phone_handoff
          ui.live?.ownControl == true -> R.string.phone_human
          ui.live?.owner == "human" -> R.string.phone_other_human
          ui.live?.status == "needs_user" -> R.string.phone_needs_user
          ui.live?.status == "paused" -> R.string.phone_paused
          ui.live?.status == "running" -> R.string.phone_running
          else -> R.string.phone_ready
        }), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Box {
        TextButton(onClick = { more = true }, enabled = !ui.busy, modifier = Modifier.size(48.dp).clip(CircleShape)
          .background(MaterialTheme.colorScheme.surfaceContainer).testTag("phone-more")) { Text("•••") }
        DropdownMenu(more, { more = false }) {
          if (ui.live?.ownControl == true) {
            DropdownMenuItem(text = { Text(stringResource(R.string.phone_back)) }, enabled = !ui.busy,
              onClick = { more = false; onCommand("input", JSONObject().put("type", "back")) })
            DropdownMenuItem(text = { Text(stringResource(R.string.phone_text)) }, enabled = !ui.busy && !ui.live.manualText,
              onClick = { more = false; textOpen = true })
            DropdownMenuItem(text = { Text(stringResource(R.string.phone_release)) }, enabled = !ui.busy,
              onClick = { more = false; onCommand("release", null) })
          } else if (ui.canControl && ui.live?.restore != true) DropdownMenuItem(
            text = { Text(stringResource(if (ui.live?.status == "paused") R.string.phone_continue else R.string.phone_pause)) }, enabled = !ui.busy,
            onClick = { more = false; onCommand(if (ui.live?.status == "paused") "handback" else "pause", null) })
          DropdownMenuItem(text = { Text(stringResource(R.string.phone_retry)) }, enabled = !ui.busy && ui.summary?.access != "none",
            onClick = { more = false; onRetry() })
          if (ui.canControl) DropdownMenuItem(text = { Text(stringResource(R.string.phone_stop), color = MaterialTheme.colorScheme.error) },
            enabled = !ui.busy, onClick = { more = false; stopSession = ui.live?.sessionId.orEmpty(); stopOpen = true })
        }
      }
    }
    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainer), contentAlignment = Alignment.Center) {
      val imageWidth = if (ui.fallback) ui.frame?.bitmap?.width ?: 1 else ui.width
      val imageHeight = if (ui.fallback) ui.frame?.bitmap?.height ?: 2 else ui.height
      val ratio = imageWidth.toFloat() / imageHeight
      val width = min(maxWidth.value, maxHeight.value * ratio).dp
      val height = (width.value / ratio).dp
      Box(Modifier.size(width, height).then(if (ui.live?.ownControl == true && !ui.busy) Modifier
        .pointerInput(ui.live.epoch, ui.geometry) {
          awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            fun send(phase: String, point: Offset) = onPointer(phase,
              (point.x / size.width * 1000).coerceIn(0f, 1000f).toInt(), (point.y / size.height * 1000).coerceIn(0f, 1000f).toInt())
            down.consume(); send("down", down.position)
            var released = false
            try {
              do {
                val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                released = !change.pressed; change.consume(); send(if (change.pressed) "move" else "up", change.position)
              } while (change.pressed)
            } finally { if (!released) onPointer("cancel", 0, 0) }
          }
        } else Modifier)) {
        video(Modifier.fillMaxSize().testTag(if (ui.playing) "phone-video-live" else "phone-video-connecting"))
        if (ui.fallback && ui.frame != null) Image(ui.frame.bitmap.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
      }
      if (!ui.playing && !(ui.fallback && ui.frame != null)) Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainer).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
        if (ui.summary?.available != false && ui.summary?.access != "none" && !ui.error && ui.live?.restore != true) {
          Spacer(Modifier.fillMaxWidth(.7f).height(28.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest))
          Spacer(Modifier.fillMaxWidth(.9f).height(180.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest))
        }
        Text(stringResource(when { ui.summary?.available == false -> R.string.phone_unavailable
          ui.summary?.access == "none" -> R.string.phone_permission_required
          ui.live?.restore == true -> R.string.phone_restore_hint; ui.error -> R.string.phone_connection_failed; else -> R.string.phone_connecting }))
      }
    }
    if (ui.fallback) Text(stringResource(R.string.phone_snapshot_mode), style = MaterialTheme.typography.labelSmall)
    if (ui.error && ui.live != null) Text(stringResource(R.string.phone_action_failed), color = MaterialTheme.colorScheme.error)
    if (ui.canControl) Button(onClick = { onCommand(if (ui.live?.ownControl == true) "handback" else "takeover", null) },
      enabled = !ui.busy && (ui.live?.ownControl == true || ui.live?.restore == true || ui.playing || ui.frame?.let { System.currentTimeMillis() - it.capturedAt < 5000 } == true),
      colors = if (ui.live?.ownControl == true) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest, contentColor = MaterialTheme.colorScheme.onSurface) else ButtonDefaults.buttonColors(),
      modifier = Modifier.fillMaxWidth().height(52.dp).testTag("phone-control")) {
      Text(stringResource(if (ui.live?.ownControl == true) R.string.phone_handback else R.string.phone_takeover))
    } else if (ui.summary?.access == "view") Text(stringResource(R.string.phone_view_only))
  }
  if (textOpen && ui.live?.ownControl == true) ModalBottomSheet(onDismissRequest = { textOpen = false; draft = "" }) {
    Column(Modifier.fillMaxWidth().imePadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      Text(stringResource(R.string.phone_text), style = MaterialTheme.typography.titleLarge)
      OutlinedTextField(draft, { draft = it }, Modifier.fillMaxWidth().testTag("phone-text-input"), placeholder = { Text(stringResource(R.string.phone_text_placeholder)) })
      Button(onClick = { onCommand("input", JSONObject().put("type", "typeText").put("text", draft)); draft = ""; textOpen = false },
        enabled = draft.isNotBlank() && !ui.busy, modifier = Modifier.fillMaxWidth().testTag("phone-text-send")) { Text(stringResource(R.string.phone_send)) }
    }
  }
  if (stopOpen) AlertDialog(onDismissRequest = { stopOpen = false }, text = { Text(stringResource(R.string.phone_stop_confirm)) },
    confirmButton = { TextButton(onClick = { stopOpen = false; if (stopSession == ui.live?.sessionId) onCommand("cancel", null) }) { Text(stringResource(R.string.phone_stop), color = MaterialTheme.colorScheme.error) } },
    dismissButton = { TextButton(onClick = { stopOpen = false }) { Text(stringResource(R.string.phone_cancel)) } })
}
