package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.withContext

internal enum class PreviewFileKind { MARKDOWN, HTML, SVG, PDF, TEXT, BINARY }

internal fun isBitmapPreview(name: String, mimeType: String): Boolean {
  val extension = name.substringAfterLast('.', "").lowercase()
  return mimeType.startsWith("image/") && mimeType != "image/svg+xml" ||
    extension in setOf("png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif")
}

internal fun previewFileKind(name: String, mimeType: String): PreviewFileKind {
  val extension = name.substringAfterLast('.', "").lowercase()
  val mime = mimeType.substringBefore(';').trim().lowercase()
  return when {
    mime == "text/markdown" || extension in setOf("md", "markdown") -> PreviewFileKind.MARKDOWN
    mime == "text/html" || extension in setOf("html", "htm") -> PreviewFileKind.HTML
    mime == "image/svg+xml" || extension == "svg" -> PreviewFileKind.SVG
    mime == "application/pdf" || extension == "pdf" -> PreviewFileKind.PDF
    mime.startsWith("text/") || mime in setOf("application/json", "application/xml", "application/javascript") ||
      extension in setOf("txt", "json", "jsonc", "json5", "csv", "tsv", "xml", "yaml", "yml", "toml",
        "ini", "conf", "properties", "env", "log", "css", "scss", "less", "js", "mjs", "cjs",
        "ts", "tsx", "jsx", "sql", "py", "rb", "java", "kt", "swift", "go", "rs", "sh",
        "bash", "zsh") -> PreviewFileKind.TEXT
    else -> PreviewFileKind.BINARY
  }
}

@Composable
internal fun FilePreviewContent(name: String, mimeType: String, bytes: ByteArray,
  modifier: Modifier = Modifier) {
  val context = LocalContext.current
  when (previewFileKind(name, mimeType)) {
    PreviewFileKind.MARKDOWN -> Column(modifier.verticalScroll(rememberScrollState())
      .testTag("file-preview-markdown")) {
      RichMessageText(bytes.toString(Charsets.UTF_8).take(100_000), onOpenLink = { url ->
        val uri = Uri.parse(url)
        if (uri.scheme in listOf("http", "https")) runCatching {
          context.startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
      }, onCopy = { code ->
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
          .setPrimaryClip(ClipData.newPlainText("code", code))
      })
    }
    PreviewFileKind.HTML -> if (bytes.size <= 4 * 1024 * 1024) {
      HtmlFilePreview(bytes.toString(Charsets.UTF_8), modifier)
    } else Text(stringResource(R.string.notes_file_preview_unavailable), modifier = modifier)
    PreviewFileKind.SVG -> if (bytes.size <= 4 * 1024 * 1024) {
      HtmlFilePreview(bytes.toString(Charsets.UTF_8), modifier)
    } else Text(stringResource(R.string.notes_file_preview_unavailable), modifier = modifier)
    PreviewFileKind.PDF -> PdfFilePreview(bytes, modifier)
    PreviewFileKind.TEXT -> SelectionContainer {
      Text(bytes.toString(Charsets.UTF_8).take(100_000), modifier = modifier
        .verticalScroll(rememberScrollState()).testTag("file-preview-text"),
        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
        style = MaterialTheme.typography.bodySmall)
    }
    PreviewFileKind.BINARY -> Text(stringResource(R.string.notes_file_preview_unavailable),
      modifier = modifier)
  }
}

private fun safePreviewHtml(html: String): String {
  val policy = "default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; " +
    "img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; " +
    "object-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'"
  val meta = "<meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" " +
    "content=\"$policy\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<style>html,body{min-height:100%;margin:0;padding:0}body{overflow-wrap:anywhere}" +
    "img,video,canvas,svg{max-width:100%;height:auto}</style>"
  val head = Regex("<head(\\s[^>]*)?>", RegexOption.IGNORE_CASE)
  val match = head.find(html)
  return if (match != null) html.replaceRange(match.range, match.value + meta)
    else "<!doctype html><html><head>$meta</head><body>$html</body></html>"
}

@Composable
private fun HtmlFilePreview(html: String, modifier: Modifier) {
  val context = LocalContext.current
  val webView = remember(context, html) {
    WebView(context).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = false
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.blockNetworkLoads = true
      settings.javaScriptCanOpenWindowsAutomatically = false
      settings.setSupportMultipleWindows(false)
      settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        @Deprecated("Compatibility with API 26 WebView callbacks")
        override fun shouldOverrideUrlLoading(view: WebView, url: String) = true
      }
      loadDataWithBaseURL(null, safePreviewHtml(html), "text/html", "UTF-8", null)
    }
  }
  DisposableEffect(webView) { onDispose { webView.stopLoading(); webView.destroy() } }
  AndroidView(factory = { webView }, modifier = modifier.testTag("file-preview-html"))
}

private class PdfPreviewHandle(val file: File, val descriptor: ParcelFileDescriptor,
  val renderer: PdfRenderer) {
  fun close() { renderer.close(); descriptor.close(); file.delete() }
}

@Composable
private fun PdfFilePreview(bytes: ByteArray, modifier: Modifier) {
  val context = LocalContext.current
  val source by produceState<Result<PdfPreviewHandle>?>(null, bytes) {
    val result = withContext(Dispatchers.IO + NonCancellable) {
      runCatching {
        val file = File.createTempFile("xopc-preview-", ".pdf", context.cacheDir)
        try {
          file.writeBytes(bytes)
          val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
          try { PdfPreviewHandle(file, descriptor, PdfRenderer(descriptor)) }
          catch (error: Exception) { descriptor.close(); throw error }
        } catch (error: Exception) { file.delete(); throw error }
      }
    }
    try {
      value = result
      awaitCancellation()
    } finally { result.getOrNull()?.close() }
  }
  val handle = source?.getOrNull()
  var pageIndex by remember(bytes) { mutableIntStateOf(0) }
  if (handle == null) {
    if (source == null) CircularProgressIndicator(modifier = modifier.testTag("file-preview-pdf-status"))
    else Text(stringResource(R.string.notes_file_preview_unavailable),
      modifier = modifier.testTag("file-preview-pdf-status"))
    return
  }
  val page by produceState<Bitmap?>(null, handle, pageIndex) {
    value = withContext(Dispatchers.IO) {
      runCatching {
        handle.renderer.openPage(pageIndex).use { pdfPage ->
          val scale = minOf(1f, 1600f / maxOf(pdfPage.width, pdfPage.height))
          val width = (pdfPage.width * scale).toInt().coerceAtLeast(1)
          val height = (pdfPage.height * scale).toInt().coerceAtLeast(1)
          Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap ->
            bitmap.eraseColor(Color.WHITE)
            pdfPage.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          }
        }
      }.getOrNull()
    }
  }
  Column(modifier.testTag("file-preview-pdf"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      OutlinedButton(onClick = { pageIndex-- }, enabled = pageIndex > 0) { Text("‹") }
      Text("${pageIndex + 1} / ${handle.renderer.pageCount}",
        modifier = Modifier.padding(top = 12.dp))
      OutlinedButton(onClick = { pageIndex++ }, enabled = pageIndex + 1 < handle.renderer.pageCount) {
        Text("›")
      }
    }
    if (page != null) Image(page!!.asImageBitmap(), contentDescription = nameForPdfPage(pageIndex),
      modifier = Modifier.fillMaxWidth().heightIn(max = 600.dp), contentScale = ContentScale.Fit)
    else Text(stringResource(R.string.notes_file_preview_unavailable))
  }
}

private fun nameForPdfPage(index: Int) = "PDF page ${index + 1}"
