package ai.xopc.mobile.ui.main

import android.graphics.Bitmap
import android.net.Uri
import android.os.SystemClock
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.webkit.WebViewAssetLoader
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.BrowserPreviewAccess
import ai.xopc.mobile.gateway.BrowserPreviewStatus
import ai.xopc.mobile.gateway.GatewayHttpException
import ai.xopc.mobile.gateway.ManagedBrowserFrameResult
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

internal val LocalBrowserPreviewOpen = staticCompositionLocalOf<(() -> Unit)?> { null }

private data class PreviewSelection(
  val conversationId: String,
  val title: String,
  val mode: String = "extension",
  val instanceId: String = UUID.randomUUID().toString(),
)

private val TERMINAL_STATES = setOf("ended", "expired", "busy", "unavailable")

@Composable
internal fun BrowserPreviewHost(access: BrowserPreviewAccess?, connection: ConnectionUiState, content: @Composable () -> Unit) {
  val gatewayId = connection.profile?.gatewayId
  val conversationId = connection.selectedConversationId
  val connected = connection.realtimeStatus == "connected"
  var selection by remember(gatewayId, access) { mutableStateOf<PreviewSelection?>(null) }
  var previewStatus by remember(gatewayId, conversationId, connected) { mutableStateOf<BrowserPreviewStatus?>(null) }
  LaunchedEffect(access, gatewayId, conversationId, connection.activeRunId, connected) {
    if (access == null || gatewayId == null || conversationId == null || !connected) {
      previewStatus = null
      return@LaunchedEffect
    }
    while (isActive) {
      previewStatus = try { access.status(gatewayId, conversationId) }
      catch (cancelled: CancellationException) { throw cancelled }
      catch (_: Exception) { null }
      delay(if (connection.activeRunId != null || previewStatus?.status == "needs_user") 1800 else 3500)
    }
  }
  LaunchedEffect(connected) { if (!connected) selection = null }
  LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
    if (selection?.mode != "managed") selection = null
  }
  val fallbackTitle = stringResource(R.string.browser_preview_open)
  val available = previewStatus?.available == true
  val detectedMode = previewStatus?.mode ?: "extension"
  val open: (() -> Unit)? = if (available && conversationId != null) {
    { selection = PreviewSelection(conversationId, connection.conversations.find { it.id == conversationId }?.title ?: fallbackTitle, detectedMode) }
  } else null
  CompositionLocalProvider(LocalBrowserPreviewOpen provides open) {
    Box(Modifier.fillMaxSize()) {
      content()
      val current = selection
      if (access != null && gatewayId != null && current != null) key(current) {
        if (current.mode == "managed") {
          AndroidManagedBrowserPreview(
            access = access,
            gatewayId = gatewayId,
            selection = current,
            onClose = { selection = null },
          )
        } else {
          AndroidBrowserPreview(
            access = access,
            gatewayId = gatewayId,
            selection = current,
            onRetry = { selection = current.copy(instanceId = UUID.randomUUID().toString()) },
            onClose = { selection = null },
          )
        }
      }
    }
  }
}

private fun normalizedImagePoint(
  boxSize: IntSize,
  bitmapWidth: Int,
  bitmapHeight: Int,
  x: Float,
  y: Float,
): Pair<Double, Double>? {
  if (boxSize.width <= 0 || boxSize.height <= 0 || bitmapWidth <= 0 || bitmapHeight <= 0) return null
  val boxRatio = boxSize.width.toFloat() / boxSize.height.toFloat()
  val contentRatio = bitmapWidth.toFloat() / bitmapHeight.toFloat()
  var drawW = boxSize.width.toFloat()
  var drawH = boxSize.height.toFloat()
  var offsetX = 0f
  var offsetY = 0f
  if (contentRatio > boxRatio) {
    drawH = boxSize.width.toFloat() / contentRatio
    offsetY = (boxSize.height - drawH) / 2f
  } else {
    drawW = boxSize.height.toFloat() * contentRatio
    offsetX = (boxSize.width - drawW) / 2f
  }
  val relX = (x - offsetX) / drawW
  val relY = (y - offsetY) / drawH
  if (relX < 0f || relX > 1f || relY < 0f || relY > 1f) return null
  return relX.coerceIn(0f, 1f).toDouble() to relY.coerceIn(0f, 1f).toDouble()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AndroidManagedBrowserPreview(
  access: BrowserPreviewAccess,
  gatewayId: String,
  selection: PreviewSelection,
  onClose: () -> Unit,
) {
  val scope = rememberCoroutineScope()
  val clientId = remember { UUID.randomUUID().toString() }
  val seq = remember { AtomicInteger(0) }
  var expanded by remember { mutableStateOf(true) }
  var corner by remember { mutableStateOf(Alignment.TopEnd) }
  var status by remember { mutableStateOf<BrowserPreviewStatus?>(null) }
  var frame by remember { mutableStateOf<Bitmap?>(null) }
  var privacyPaused by remember { mutableStateOf(false) }
  var ended by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var textOpen by remember { mutableStateOf(false) }
  var draft by remember { mutableStateOf("") }
  var viewportBox by remember { mutableStateOf(IntSize.Zero) }

  val ownControl = status?.ownControl == true
  val controlEpoch = status?.controlEpoch ?: 0

  fun sendManagedEvent(event: JSONObject) {
    val currentEpoch = status?.controlEpoch ?: 0
    if (status?.ownControl != true || currentEpoch <= 0) return
    val nextSeq = seq.incrementAndGet()
    scope.launch {
      try {
        access.managedInput(gatewayId, selection.conversationId, clientId, currentEpoch, nextSeq, event)
      } catch (_: Exception) {
        /* Status/heartbeat reconciles lost control leases. */
      }
    }
  }

  fun releaseControl() {
    val currentEpoch = status?.controlEpoch
    if (status?.ownControl != true) return
    status = status?.copy(ownControl = false, status = if (status?.assistanceId != null) "needs_user" else "running")
    scope.launch {
      runCatching { access.managedRelease(gatewayId, selection.conversationId, clientId, currentEpoch) }
    }
  }

  LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
    releaseControl()
  }

  DisposableEffect(access, gatewayId, selection.conversationId, clientId) {
    onDispose {
      val currentEpoch = status?.controlEpoch
      if (status?.ownControl == true) {
        scope.launch {
          runCatching { access.managedRelease(gatewayId, selection.conversationId, clientId, currentEpoch) }
        }
      }
    }
  }

  // Poll status
  LaunchedEffect(access, gatewayId, selection.conversationId, clientId) {
    while (isActive) {
      val latest = try { access.status(gatewayId, selection.conversationId, clientId) }
      catch (cancelled: CancellationException) { throw cancelled }
      catch (_: Exception) { null }
      if (latest != null) {
        status = latest
        privacyPaused = latest.privacyPaused
        if (!latest.available) ended = true
      }
      delay(2000)
    }
  }

  // Heartbeat while controlling
  LaunchedEffect(ownControl, controlEpoch) {
    if (!ownControl || controlEpoch <= 0) return@LaunchedEffect
    while (isActive) {
      delay(3000)
      try {
        status = access.managedHeartbeat(gatewayId, selection.conversationId, clientId, controlEpoch)
      } catch (cancelled: CancellationException) {
        throw cancelled
      } catch (_: Exception) {
        status = status?.copy(ownControl = false)
        break
      }
    }
  }

  // Immediate-wakeup frame stream
  LaunchedEffect(access, gatewayId, selection.conversationId, clientId) {
    var after = 0L
    while (isActive && !ended) {
      val result = try { access.managedFrame(gatewayId, selection.conversationId, clientId, after) }
      catch (cancelled: CancellationException) { throw cancelled }
      catch (_: Exception) { delay(500); ManagedBrowserFrameResult.Empty }
      when (result) {
        is ManagedBrowserFrameResult.Frame -> {
          after = result.seq
          frame = result.bitmap
          privacyPaused = false
        }
        ManagedBrowserFrameResult.PrivacyPaused -> {
          frame = null
          privacyPaused = true
          delay(800)
        }
        ManagedBrowserFrameResult.Unavailable -> {
          frame = null
          ended = true
        }
        ManagedBrowserFrameResult.Empty -> Unit
      }
    }
  }

  fun startTakeover() {
    if (busy) return
    busy = true
    scope.launch {
      try {
        val next = access.managedTakeover(gatewayId, selection.conversationId, clientId)
        seq.set(0)
        status = next
        privacyPaused = false
      } catch (_: Exception) {
        /* Keep viewing state on contention or transient failure. */
      } finally {
        busy = false
      }
    }
  }

  fun completeHandback() {
    if (busy) return
    busy = true
    scope.launch {
      try {
        val next = access.managedHandback(gatewayId, selection.conversationId, clientId, status?.controlEpoch)
        status = next
      } catch (_: Exception) {
        /* User can retry handback if network dropped. */
      } finally {
        busy = false
      }
    }
  }

  if (ownControl) {
    Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding()) {
      Column(Modifier.fillMaxSize()) {
        Row(
          Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text(
            status?.url?.ifBlank { selection.title } ?: selection.title,
            Modifier.weight(1f).padding(end = 8.dp),
            maxLines = 1,
            style = MaterialTheme.typography.labelLarge,
          )
          TextButton(onClick = { sendManagedEvent(JSONObject().put("kind", "navigate").put("action", "back")) }) {
            Text(stringResource(R.string.browser_preview_back))
          }
          TextButton(onClick = { sendManagedEvent(JSONObject().put("kind", "navigate").put("action", "reload")) }) {
            Text(stringResource(R.string.browser_preview_reload))
          }
          TextButton(onClick = { releaseControl() }) {
            Text(stringResource(R.string.browser_preview_pause_control))
          }
        }
        Box(
          Modifier.weight(1f).fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLowest)
            .onSizeChanged { viewportBox = it }
            .pointerInput(controlEpoch, frame) {
              detectTapGestures { offset ->
                val bmp = frame ?: return@detectTapGestures
                val point = normalizedImagePoint(viewportBox, bmp.width, bmp.height, offset.x, offset.y) ?: return@detectTapGestures
                sendManagedEvent(JSONObject().put("kind", "pointer").put("phase", "click").put("x", point.first).put("y", point.second))
              }
            }
            .pointerInput(controlEpoch, frame) {
              detectDragGestures { change, dragAmount ->
                change.consume()
                val bmp = frame ?: return@detectDragGestures
                val point = normalizedImagePoint(viewportBox, bmp.width, bmp.height, change.position.x, change.position.y) ?: return@detectDragGestures
                sendManagedEvent(JSONObject().put("kind", "wheel").put("x", point.first).put("y", point.second)
                  .put("deltaX", -dragAmount.x * 2.0).put("deltaY", -dragAmount.y * 2.0))
              }
            },
        ) {
          val currentFrame = frame
          if (currentFrame != null) {
            Image(currentFrame.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
          } else {
            CircularProgressIndicator(Modifier.align(Alignment.Center))
          }
        }
        Row(
          Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          TextButton(onClick = { draft = ""; textOpen = true }, enabled = !busy) {
            Text(stringResource(R.string.browser_preview_type_text))
          }
          TextButton(onClick = { sendManagedEvent(JSONObject().put("kind", "key").put("key", "Enter")) }, enabled = !busy) {
            Text(stringResource(R.string.browser_preview_enter_key))
          }
          Button(
            onClick = { completeHandback() },
            enabled = !busy,
            modifier = Modifier.weight(1f).height(44.dp),
          ) {
            Text(stringResource(R.string.browser_preview_handback))
          }
        }
      }
    }
    if (textOpen) {
      XopcBottomSheet(XopcSheetPreset.Compact, onDismissRequest = { textOpen = false; draft = "" }) {
        Column(Modifier.fillMaxWidth().imePadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
          Text(stringResource(R.string.browser_preview_type_text), style = MaterialTheme.typography.titleLarge)
          OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(stringResource(R.string.browser_preview_type_placeholder)) },
          )
          Button(
            onClick = {
              val value = draft
              draft = ""
              textOpen = false
              if (value.isNotEmpty()) sendManagedEvent(JSONObject().put("kind", "text").put("text", value))
            },
            enabled = draft.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
          ) {
            Text(stringResource(R.string.browser_preview_send))
          }
        }
      }
    }
    return
  }

  val windowState = when {
    ended -> "ended"
    privacyPaused -> "privacy_paused"
    status?.status == "needs_user" -> "needs_user"
    frame != null -> "playing"
    else -> "connecting"
  }
  BrowserPreviewWindow(
    title = selection.title,
    source = status?.reason ?: status?.url.orEmpty(),
    state = windowState,
    quality = "normal",
    expanded = expanded,
    corner = corner,
    onToggle = { expanded = !expanded },
    onMove = { corner = it },
    onClose = onClose,
    primaryActionLabel = if (!ended && !privacyPaused) stringResource(R.string.browser_preview_takeover) else null,
    onPrimaryAction = if (!ended && !privacyPaused && !busy) ({ startTakeover() }) else null,
  ) {
    val currentFrame = frame
    if (currentFrame != null && !privacyPaused && !ended) {
      Image(currentFrame.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
    } else if (!ended && !privacyPaused) {
      CircularProgressIndicator(Modifier.align(Alignment.Center))
    }
  }
}

private class PreviewPlayback {
  var port: WebMessagePort? = null
  var started = false
  fun dispatch(message: JSONObject) { port?.postMessage(WebMessage(message.toString())) }
}

@Composable
private fun AndroidBrowserPreview(
  access: BrowserPreviewAccess,
  gatewayId: String,
  selection: PreviewSelection,
  onRetry: () -> Unit,
  onClose: () -> Unit,
) {
  val requestId = remember { UUID.randomUUID().toString() }
  val playback = remember { PreviewPlayback() }
  var expanded by remember { mutableStateOf(true) }
  var corner by remember { mutableStateOf(Alignment.TopEnd) }
  var accepted by remember { mutableStateOf(false) }
  var state by remember { mutableStateOf("connecting") }
  var quality by remember { mutableStateOf("normal") }
  var source by remember { mutableStateOf("") }
  var snapshotToken by remember { mutableStateOf<String?>(null) }
  var snapshot by remember { mutableStateOf<Bitmap?>(null) }
  var deadline by remember { mutableStateOf(SystemClock.elapsedRealtime() + 12_000) }

  fun send(type: String, payload: JSONObject = JSONObject()): Boolean =
    access.send(payload.put("requestId", requestId).put("type", type))

  fun clear(reason: String = "ended") {
    accepted = false
    state = if (reason in TERMINAL_STATES) reason else "ended"
    snapshotToken = null
    snapshot = null
    playback.dispatch(JSONObject().put("type", "stop"))
  }

  DisposableEffect(access, requestId) {
    onDispose {
      if (playback.started) send("close")
      playback.port?.close()
      playback.port = null
    }
  }
  LaunchedEffect(access, requestId) {
    access.messages.collect { message ->
      if (message.optString("requestId") != requestId || state in TERMINAL_STATES) return@collect
      when (message.optString("type")) {
        "waiting" -> {
          source = message.optString("origin")
          deadline = SystemClock.elapsedRealtime() + 60_000
          state = "waiting"
        }
        "accepted" -> {
          accepted = true
          state = "connecting"
          deadline = SystemClock.elapsedRealtime() + 10_000
          playback.dispatch(message)
        }
        "lease" -> deadline = SystemClock.elapsedRealtime() + 10_000
        "signal" -> playback.dispatch(message)
        "quality" -> if (quality == "snapshot" && message.optString("quality") == "snapshot") {
          snapshotToken = message.optString("snapshotToken").takeIf(String::isNotBlank)
        }
        "closed" -> clear(message.optString("reason", "ended"))
      }
    }
  }
  LaunchedEffect(deadline) {
    delay((deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
    if (state !in TERMINAL_STATES) { send("close"); clear("expired") }
  }
  LaunchedEffect(accepted) {
    if (!accepted) return@LaunchedEffect
    while (isActive) { delay(3000); send("renew") }
  }
  LaunchedEffect(snapshotToken) {
    val token = snapshotToken ?: return@LaunchedEffect
    var after = 0L
    var lastFrame = if (snapshot != null) SystemClock.elapsedRealtime() else 0L
    while (isActive) {
      val result = try { access.snapshot(gatewayId, requestId, token, after) }
      catch (cancelled: CancellationException) { throw cancelled }
      catch (error: GatewayHttpException) {
        if (error.status == 403 || error.status == 404) { clear("ended"); return@LaunchedEffect }
        null
      } catch (_: Exception) { null }
      if (result != null) {
        after = result.first
        snapshot = result.second
        lastFrame = SystemClock.elapsedRealtime()
      } else if (lastFrame > 0L && SystemClock.elapsedRealtime() - lastFrame > 2000) snapshot = null
      delay(600)
    }
  }

  BrowserPreviewWindow(selection.title, source, state, quality, expanded, corner, onToggle = { expanded = !expanded },
    onMove = { corner = it }, onRetry = if (state in TERMINAL_STATES) onRetry else null, onClose = onClose) {
    AndroidView(
      modifier = Modifier.fillMaxSize().alpha(if (state == "playing") 1f else 0f),
      factory = { context ->
        val base = "https://appassets.androidplatform.net"
        val page = "$base/assets/browser-preview.html"
        val script = "$base/assets/browser-preview.js"
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
        WebView(context).apply {
          settings.javaScriptEnabled = true
          settings.allowFileAccess = false
          settings.allowContentAccess = false
          settings.mediaPlaybackRequiresUserGesture = false
          webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
              if (request.url.toString() in setOf(page, script)) assets.shouldInterceptRequest(request.url)
              else WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(byteArrayOf()))

            override fun onPageFinished(view: WebView, url: String) {
              if (url != page || playback.port != null) return
              val ports = view.createWebMessageChannel()
              playback.port = ports[0]
              ports[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                override fun onMessage(port: WebMessagePort, message: WebMessage) {
                  val data = message.data?.takeIf { it.length <= 65_536 } ?: return
                  val event = runCatching { JSONObject(data) }.getOrNull() ?: return
                  if (state in TERMINAL_STATES) return
                  when (event.optString("type")) {
                    "ready" -> if (!playback.started) {
                      playback.started = send("view", JSONObject().put("conversationId", selection.conversationId))
                      if (!playback.started) clear("unavailable")
                    }
                    "signal" -> event.optJSONObject("signal")?.let { send("signal", JSONObject().put("signal", it)) }
                    "playing" -> {
                      snapshotToken = null
                      snapshot = null
                      state = "playing"
                    }
                    "quality" -> {
                      val next = event.optString("quality").takeIf { it in setOf("normal", "low", "snapshot") } ?: return
                      if (!send("quality", JSONObject().put("quality", next))) { clear("unavailable"); return }
                      quality = next
                      if (next == "snapshot") state = "snapshot"
                      else snapshotToken = null
                    }
                  }
                }
              })
              view.postWebMessage(WebMessage("xopc-browser-preview", arrayOf(ports[1])), Uri.parse(base))
            }
          }
          loadUrl(page)
        }
      },
      onRelease = { view -> view.stopLoading(); view.destroy() },
    )
    if (state == "snapshot") snapshot?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize()) }
    if (state == "connecting" || (state == "snapshot" && snapshot == null)) {
      CircularProgressIndicator(Modifier.align(Alignment.Center))
    }
  }
}

@Composable
internal fun BrowserPreviewWindow(title: String, source: String, state: String, quality: String,
  expanded: Boolean, corner: Alignment, onToggle: () -> Unit, onMove: (Alignment) -> Unit, onClose: () -> Unit,
  onRetry: (() -> Unit)? = null,
  primaryActionLabel: String? = null,
  onPrimaryAction: (() -> Unit)? = null,
  content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) {
  var dragX by remember(expanded, corner) { mutableStateOf(0f) }
  var dragY by remember(expanded, corner) { mutableStateOf(0f) }
  Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).imePadding().padding(12.dp)) {
    Card(Modifier.align(if (expanded) Alignment.Center else corner)
      .then(if (expanded) Modifier.widthIn(max = 560.dp).fillMaxWidth() else Modifier.fillMaxWidth(0.49f))
      .graphicsLayer {
        translationX = if (expanded) 0f else dragX
        translationY = if (expanded) 0f else dragY
      }
      .pointerInput(expanded, corner) {
        if (!expanded) {
          detectDragGestures(
            onDragStart = { dragX = 0f; dragY = 0f },
            onDragCancel = { dragX = 0f; dragY = 0f },
            onDragEnd = {
              val threshold = 24.dp.toPx()
              val atEnd = if (kotlin.math.abs(dragX) > threshold) dragX > 0 else corner in setOf(Alignment.TopEnd, Alignment.BottomEnd)
              val atBottom = if (kotlin.math.abs(dragY) > threshold) dragY > 0 else corner in setOf(Alignment.BottomStart, Alignment.BottomEnd)
              dragX = 0f
              dragY = 0f
              onMove(if (atBottom) if (atEnd) Alignment.BottomEnd else Alignment.BottomStart
                else if (atEnd) Alignment.TopEnd else Alignment.TopStart)
            },
          ) { change, delta -> change.consume(); dragX += delta.x; dragY += delta.y }
        }
      }) {
      Column {
        Text(title, Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
          maxLines = 1, style = MaterialTheme.typography.labelLarge)
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f), content = content)
        val text = when (state) {
          "waiting" -> R.string.browser_preview_waiting
          "snapshot" -> R.string.browser_preview_snapshot
          "needs_user" -> R.string.browser_preview_needs_user
          "privacy_paused" -> R.string.browser_preview_privacy_paused
          "ended" -> R.string.browser_preview_ended
          "expired" -> R.string.browser_preview_expired
          "busy" -> R.string.browser_preview_busy
          "unavailable" -> R.string.browser_preview_unavailable
          "playing" -> if (quality == "low") R.string.browser_preview_low else R.string.browser_preview_live
          else -> R.string.browser_preview_connecting
        }
        Text(stringResource(text), Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.bodySmall)
        if (expanded && source.isNotBlank()) Text(source, Modifier.padding(horizontal = 10.dp), maxLines = 1, style = MaterialTheme.typography.labelSmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
          if (primaryActionLabel != null && onPrimaryAction != null) {
            TextButton(onClick = onPrimaryAction) { Text(primaryActionLabel) }
          }
          if (onRetry != null) {
            TextButton(onClick = onRetry) { Text(stringResource(R.string.browser_preview_retry)) }
          }
          TextButton(onClick = onToggle) { Text(stringResource(if (expanded) R.string.browser_preview_shrink else R.string.browser_preview_expand)) }
          TextButton(onClick = onClose) { Text(stringResource(R.string.browser_preview_close)) }
        }
      }
    }
  }
}
