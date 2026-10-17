package ai.xopc.mobile.ui.main

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.util.Base64
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.util.UUID

/** Composition-owned leases, shared by chat and document renderers on the UI thread. */
internal object ChartWebBudget {
  var active by mutableStateOf<List<String>>(emptyList())
    private set
  private val waiting = linkedSetOf<String>()
  fun request(id: String, priority: Boolean = false) {
    if (id in active) return
    waiting.add(id)
    if (priority && active.size == 2) {
      val displaced = active.first(); active = active - displaced; waiting.add(displaced)
      waiting.remove(id); active = active + id
    }
    promote()
  }
  fun release(id: String) { waiting.remove(id); active = active - id; promote() }
  private fun promote() {
    while (active.size < 2 && waiting.isNotEmpty()) {
      val id = waiting.first(); waiting.remove(id); active = active + id
    }
  }
}

internal fun chartSourceAllowed(source: String): Boolean =
  source.length <= 102400 && source.toByteArray(Charsets.UTF_8).size <= 102400

private class ChartHandle { var view: WebView? = null; var shareRequested = false }
private class ChartBridge(private val receive: (String) -> Unit) {
  @JavascriptInterface fun postMessage(message: String) = receive(message)
}

@Composable
internal fun ChartMarkdownView(source: String, closed: Boolean, modifier: Modifier = Modifier,
  onCopy: ((String) -> Unit)? = null) {
  val context = LocalContext.current
  val window = LocalView.current
  val id = remember { UUID.randomUUID().toString() }
  val allowed = remember(source) { chartSourceAllowed(source) }
  val handle = remember { ChartHandle() }
  var visible by remember { mutableStateOf(false) }
  var expanded by remember { mutableStateOf(false) }
  var showSource by remember { mutableStateOf(false) }
  var rendered by remember(source) { mutableStateOf(false) }
  var height by remember { mutableStateOf(400f) }
  var error by remember(source) { mutableStateOf(false) }
  LaunchedEffect(visible, expanded, closed, allowed) {
    if ((visible || expanded) && closed && allowed) ChartWebBudget.request(id, expanded) else ChartWebBudget.release(id)
  }
  DisposableEffect(id) { onDispose { ChartWebBudget.release(id) } }
  val active = id in ChartWebBudget.active
  @Composable fun content(fullscreen: Boolean) {
    Column(Modifier.fillMaxWidth().padding(8.dp)) {
      Row {
        TextButton(onClick = {
          if (onCopy != null) onCopy(source) else context.getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText("Chart JSON", source))
        }) { Text("复制数据") }
        TextButton(onClick = { expanded = !fullscreen }) { Text(if (fullscreen) "关闭" else "放大") }
        TextButton(enabled = rendered, onClick = {
          handle.shareRequested = true
          handle.view?.evaluateJavascript("window.xopcChart.exportImage()", null)
        }) { Text("分享图片") }
        TextButton(onClick = { showSource = !showSource }) { Text("源码") }
      }
      if (!closed) Text("等待图表数据完成…")
      else if (!allowed) Text("图表数据超过 100 KiB，请缩小数据范围。")
      else if (active) ChartWebContent(source, id, fullscreen, handle, height, onHeight = { height = it }, onRendered = { success ->
        rendered = success; error = !success
      }) else Text("图表将在可见时加载；可点放大查看。", Modifier.height(height.dp))
      if (error) Text("数据校验失败，可复制数据检查。")
      if (showSource) Text(source.take(4096), style = MaterialTheme.typography.bodySmall)
    }
  }
  Card(modifier.fillMaxWidth().testTag("markdown-chart").onGloballyPositioned { coordinates ->
    val bounds = coordinates.boundsInWindow()
    visible = bounds.bottom > 0 && bounds.top < window.height && bounds.width > 0
  }) {
    if (!expanded) content(false) else Text("图表已在预览中打开。", Modifier.padding(16.dp))
  }
  if (expanded) Dialog(onDismissRequest = { expanded = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Card(Modifier.fillMaxWidth().padding(12.dp).verticalScroll(rememberScrollState())) { content(true) }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ChartWebContent(source: String, id: String, expanded: Boolean, handle: ChartHandle,
  initialHeight: Float, onHeight: (Float) -> Unit, onRendered: (Boolean) -> Unit) {
  val dark = MaterialTheme.colorScheme.background.luminance() < .5f
  val latestRendered by rememberUpdatedState(onRendered)
  val density = LocalDensity.current
  var height by remember { mutableStateOf(initialHeight) }
  var failed by remember { mutableStateOf(false) }
  LaunchedEffect(source) { failed = false }
  if (failed) {
    Text("图表加载失败，可重新打开预览或复制数据。")
    return
  }
  AndroidView(modifier = Modifier.fillMaxWidth().height(height.dp).testTag("chart-webview"), factory = { context ->
    val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/charts/", object : WebViewAssetLoader.PathHandler {
      override fun handle(path: String): WebResourceResponse? {
        if (path !in setOf("index.html", "host.js", "host.css")) return null
        val mime = when (path) { "index.html" -> "text/html"; "host.js" -> "application/javascript"; else -> "text/css" }
        return WebResourceResponse(mime, "UTF-8", context.assets.open("charts/$path"))
      }
    }).build()
    WebView(context).apply {
      handle.view = this
      setBackgroundColor(android.graphics.Color.TRANSPARENT)
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = false
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.blockNetworkLoads = true
      settings.setSupportMultipleWindows(false)
      isVerticalScrollBarEnabled = false
      addJavascriptInterface(ChartBridge { message -> post {
        if (handle.view !== this || message.length > 12 * 1024 * 1024) return@post
        val data = runCatching { JSONObject(message) }.getOrNull() ?: return@post
        val current = tag as? JSONObject ?: return@post
        if (data.optString("id") != id || data.optInt("revision", -1) != current.optInt("revision")) return@post
        when (data.optString("type")) {
          "height" -> { val measured = data.optDouble("height"); if (measured.isFinite()) { height = measured.toFloat().coerceIn(100f, 1600f); onHeight(height) } }
          "rendered" -> latestRendered(true)
          "error" -> latestRendered(false)
          "image" -> if (handle.shareRequested) {
            handle.shareRequested = false
            runCatching {
              val image = data.optString("data")
              require(image.startsWith("data:image/png;base64,"))
              val bytes = Base64.decode(image.substringAfter(','), Base64.DEFAULT)
              require(bytes.size <= 8 * 1024 * 1024)
              val directory = File(context.cacheDir, "charts").apply { mkdirs() }
              directory.listFiles()?.sortedByDescending { it.lastModified() }?.drop(9)?.forEach { it.delete() }
              val file = File(directory, "$id.png").apply { writeBytes(bytes) }
              val uri = FileProvider.getUriForFile(context, "${context.packageName}.camera-capture", file)
              val intent = Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              context.startActivity(Intent.createChooser(intent, "分享图表"))
            }.onFailure { latestRendered(false) }
          }
        }
      } }, "XopcChartBridge")
      webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
          failed = true; latestRendered(false); return true
        }
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
          if (request.isForMainFrame) { failed = true; latestRendered(false) }
        }
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
          loader.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "UTF-8", 403,
            "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        override fun onPageFinished(view: WebView, url: String) {
          (view.tag as? JSONObject)?.let { view.evaluateJavascript("window.xopcChart?.update($it)", null) }
        }
      }
      loadUrl("https://appassets.androidplatform.net/assets/charts/index.html")
    }
  }, update = { view ->
    val previous = view.tag as? JSONObject
    if (previous?.optString("source") != source || previous.optBoolean("dark") != dark || previous.optBoolean("expanded") != expanded || previous.optDouble("fontSize") != (14 * density.fontScale).toDouble()) {
      val payload = JSONObject().put("id", id).put("revision", (previous?.optInt("revision") ?: 0) + 1)
        .put("source", source).put("dark", dark).put("expanded", expanded).put("fontSize", 14 * density.fontScale)
      handle.shareRequested = false
      view.tag = payload
      view.evaluateJavascript("window.xopcChart?.update($payload)", null)
    }
  }, onRelease = { view ->
    if (handle.view === view) { handle.view = null; handle.shareRequested = false }
    view.removeJavascriptInterface("XopcChartBridge"); view.stopLoading(); view.destroy()
  })
}
