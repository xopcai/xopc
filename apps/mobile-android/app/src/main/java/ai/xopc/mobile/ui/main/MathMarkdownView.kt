package ai.xopc.mobile.ui.main

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONObject
import org.commonmark.node.Block
import org.commonmark.node.CustomBlock
import org.commonmark.parser.SourceLine
import org.commonmark.parser.block.AbstractBlockParser
import org.commonmark.parser.block.AbstractBlockParserFactory
import org.commonmark.parser.block.BlockContinue
import org.commonmark.parser.block.BlockStart
import org.commonmark.parser.block.MatchedBlockParser
import org.commonmark.parser.block.ParserState

internal object MathMarkdownSyntax {
  fun candidateCount(source: String): Int = Regex("""\\[\(\[]|\$\$|\$(?=[^\s$])|(?:`{3,}|~{3,})math\b""").findAll(source).count()
  fun mayContain(source: String): Boolean = source.contains("\\(") || source.contains("\\[") || source.contains("$$") ||
    Regex("\\$[^\\s$][^\\n]*\\$").containsMatchIn(source)
  fun closingOffset(source: String): Int {
    val closer = if (source.startsWith("\\[")) "\\]" else "$$"
    var comment = false
    var slashes = 0
    for (index in 2 until source.length) {
      val char = source[index]
      if (char == '\n') comment = false
      if (char == '%' && slashes % 2 == 0) comment = true
      if (!comment && slashes % 2 == 0 && source.startsWith(closer, index)) return index
      slashes = if (char == '\\') slashes + 1 else 0
    }
    return -1
  }
  fun closed(source: String): Boolean {
    val offset = closingOffset(source)
    return offset >= 0 && source.substring(offset + 2).isBlank()
  }
}

internal class MathSourceBlock : CustomBlock() { var source: String = "" }
internal class MathBlockParser : AbstractBlockParser() {
  private val node = MathSourceBlock()
  override fun getBlock(): Block = node
  override fun tryContinue(state: ParserState): BlockContinue =
    if (MathMarkdownSyntax.closed(node.source)) BlockContinue.finished() else BlockContinue.atIndex(state.index)
  override fun addLine(line: SourceLine) {
    if (node.source.isNotEmpty()) node.source += "\n"
    node.source += line.content
  }
  class Factory : AbstractBlockParserFactory() {
    override fun tryStart(state: ParserState, matchedBlockParser: MatchedBlockParser): BlockStart? {
      val line = state.line.content.toString().substring(state.nextNonSpaceIndex)
      if (state.indent >= 4 || !(line.startsWith("\\[") || line.startsWith("$$"))) return BlockStart.none()
      if (MathMarkdownSyntax.closingOffset(line) >= 0 && !MathMarkdownSyntax.closed(line)) return BlockStart.none()
      return BlockStart.of(MathBlockParser()).atIndex(state.nextNonSpaceIndex)
    }
  }
}

private class MathBridge(val receive: (String) -> Unit) {
  @JavascriptInterface fun postMessage(message: String) { receive(message) }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun MathMarkdownView(source: String, streaming: Boolean, modifier: Modifier = Modifier,
  display: Boolean = false, fontSize: Float = 16f, enabled: Boolean = true, onOpenLink: ((String) -> Unit)? = null,
  onCopy: ((String) -> Unit)? = null) {
  val selectable = LocalMarkdownSelection.current
  val context = LocalContext.current
  val density = LocalDensity.current
  val latestLink by rememberUpdatedState(onOpenLink)
  val dark = MaterialTheme.colorScheme.background.luminance() < .5f
  var height by remember { mutableStateOf(48f) }
  Column(modifier = modifier) {
    if (!enabled) {
      Text(source, modifier = Modifier.fillMaxWidth())
    } else {
      AndroidView(modifier = Modifier.fillMaxWidth().height(height.dp).testTag("markdown-math"),
        factory = { androidContext ->
          WebView(androidContext).apply {
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            settings.blockNetworkLoads = true
            settings.allowContentAccess = false
            settings.allowFileAccess = true
            isVerticalScrollBarEnabled = false
            addJavascriptInterface(MathBridge { message ->
              post {
                val data = runCatching { JSONObject(message) }.getOrNull() ?: return@post
                val current = tag as? JSONObject ?: return@post
                if (data.optInt("revision", -1) != current.optInt("revision")) return@post
                if (data.has("href")) {
                  val href = data.optString("href")
                  if (href.startsWith("https://") || href.startsWith("http://") || href.startsWith("xopc://")) latestLink?.invoke(href)
                } else {
                  val measured = data.optDouble("height", 48.0)
                  if (measured.isFinite()) height = measured.toFloat().coerceIn(24f, 8192f)
                }
              }
            }, "XopcMathBridge")
            webViewClient = object : WebViewClient() {
              override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !request.url.toString().startsWith("file:///android_asset/math/")
              override fun onPageFinished(view: WebView, url: String) {
                val payload = view.tag as? JSONObject ?: return
                view.evaluateJavascript("window.xopcMath.update(${payload});", null)
              }
            }
            loadUrl("file:///android_asset/math/index.html")
          }
        },
        update = { view ->
          view.setOnLongClickListener { !selectable }
          view.isLongClickable = selectable
          val previous = view.tag as? JSONObject
          val next = JSONObject().put("markdown", source).put("streaming", streaming).put("dark", dark)
            .put("fontSize", fontSize * density.fontScale)
          if (previous == null || previous.optString("markdown") != source || previous.optBoolean("streaming") != streaming ||
            previous.optBoolean("dark") != dark || previous.optDouble("fontSize") != next.optDouble("fontSize")) {
            next.put("revision", (previous?.optInt("revision") ?: 0) + 1)
            view.tag = next
            // JSONObject encodes strings as data; no source interpolation or Gateway credentials.
            view.evaluateJavascript("window.xopcMath?.update(${next});", null)
          }
        },
        onRelease = { view -> view.removeJavascriptInterface("XopcMathBridge"); view.stopLoading(); view.destroy() })
    }
    if (display) TextButton(onClick = {
      if (onCopy != null) onCopy(source) else (context.getSystemService(ClipboardManager::class.java))
        .setPrimaryClip(ClipData.newPlainText("LaTeX", source))
    }) { Text("复制公式源码") }
  }
}
