package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ShareItem
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.net.URI
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Plain Share Center content; the ViewModel owns Gateway reads and mutations. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ShareCenterScreen(state: ShareCenterUiState, connected: Boolean, insets: PaddingValues,
  onBack: () -> Unit, onRefresh: () -> Unit, onRevoke: (String) -> Unit,
  onExtend: (String, Int) -> Unit) {
  var showInactive by rememberSaveable(state.gatewayId) { mutableStateOf(false) }
  var menuId by remember(state.gatewayId) { mutableStateOf<String?>(null) }
  var previewId by remember(state.gatewayId) { mutableStateOf<String?>(null) }
  var extendId by remember(state.gatewayId) { mutableStateOf<String?>(null) }
  var revokeId by remember(state.gatewayId) { mutableStateOf<String?>(null) }
  val visible = if (showInactive) state.items else state.items.filter(ShareItem::active)
  val menuItem = state.items.firstOrNull { it.id == menuId }
  val previewItem = state.items.firstOrNull { it.id == previewId }
  val extendItem = state.items.firstOrNull { it.id == extendId }
  val revokeItem = state.items.firstOrNull { it.id == revokeId }
  Column(Modifier.fillMaxSize().padding(insets).testTag("share-center")) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically) {
      IconButton(onClick = onBack, modifier = Modifier.testTag("shares-back")) {
        Text("‹", style = MaterialTheme.typography.headlineMedium)
      }
      Text(stringResource(R.string.share_center), modifier = Modifier.weight(1f),
        style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
      TextButton(onClick = { showInactive = !showInactive },
        modifier = Modifier.testTag("shares-toggle-inactive")) {
        Text(stringResource(if (showInactive) R.string.share_hide_inactive else R.string.share_show_inactive))
      }
    }
    if (!connected) {
      Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.share_connect_gateway),
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      return@Column
    }
    if (state.error) Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp),
      verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(R.string.share_load_error), modifier = Modifier.weight(1f),
        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
        maxLines = 2)
      TextButton(onClick = onRefresh, enabled = !state.loading && state.busyId == null) {
        Text(stringResource(R.string.progress_refresh))
      }
    }
    if (!state.error) TextButton(onClick = onRefresh,
      enabled = !state.loading && state.busyId == null,
      modifier = Modifier.align(Alignment.End).testTag("shares-refresh")) {
      Text(stringResource(R.string.progress_refresh))
    }
    if (state.loading && state.items.isEmpty()) {
      Box(Modifier.fillMaxSize().testTag("shares-loading"), contentAlignment = Alignment.Center) {
        BrandLoadingPanel(modifier = Modifier.fillMaxSize())
      }
    } else {
      PullToRefreshBox(isRefreshing = state.loading,
        onRefresh = { if (state.busyId == null) onRefresh() },
        modifier = Modifier.fillMaxSize().testTag("shares-refresh-gesture"),
        indicator = {
          if (state.loading) BrandLoadingIndicator(
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp), extent = 32.dp)
        }) {
      LazyColumn(modifier = Modifier.fillMaxSize().testTag("shares-list"),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (visible.isEmpty() && !state.loading) item {
          Text(stringResource(R.string.share_empty), modifier = Modifier.fillMaxWidth().padding(32.dp)
            .testTag("shares-empty"), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(visible, key = ShareItem::id) { item ->
          Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow,
            RoundedCornerShape(16.dp)).clickable { previewId = item.id }
            .padding(14.dp).testTag("share-${item.id}"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(painterResource(when (item.kind) {
              "directory" -> R.drawable.action_folder
              "session" -> R.drawable.tab_conversations
              "note" -> R.drawable.tab_notes
              else -> R.drawable.tab_notes
            }), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
              Text(item.title, style = MaterialTheme.typography.bodyLarge,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
              Text(stringResource(when {
                item.revoked -> R.string.share_revoked
                item.expired -> R.string.share_expired
                else -> R.string.share_active
              }), style = MaterialTheme.typography.labelSmall,
                color = if (item.active) MaterialTheme.colorScheme.primary
                  else MaterialTheme.colorScheme.onSurfaceVariant)
              Text(shareExpiry(item.expiresAt), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { menuId = item.id },
              enabled = state.busyId == null,
              modifier = Modifier.testTag("share-menu-${item.id}")) {
              Text("•••", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
      }
    }
  }
  if (menuItem != null) ModalBottomSheet(onDismissRequest = { menuId = null },
    modifier = Modifier.testTag("share-menu-sheet")) {
    Column(Modifier.fillMaxWidth().padding(20.dp)) {
      Text(menuItem.title, style = MaterialTheme.typography.titleMedium)
      TextButton(onClick = { previewId = menuItem.id; menuId = null },
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("share-preview")) {
        Text(stringResource(R.string.share_preview), modifier = Modifier.fillMaxWidth())
      }
      if (menuItem.active) {
        TextButton(onClick = { extendId = menuItem.id; menuId = null },
          modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("share-extend")) {
          Text(stringResource(R.string.share_extend), modifier = Modifier.fillMaxWidth())
        }
        TextButton(onClick = { revokeId = menuItem.id; menuId = null },
          modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("share-revoke")) {
          Text(stringResource(R.string.share_revoke), modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.error)
        }
      }
    }
  }
  if (extendItem != null) ModalBottomSheet(onDismissRequest = { extendId = null },
    modifier = Modifier.testTag("share-extend-sheet")) {
    Column(Modifier.fillMaxWidth().padding(20.dp)) {
      Text(stringResource(R.string.share_extend), style = MaterialTheme.typography.titleMedium)
      listOf(1 to R.string.share_extend_one, 3 to R.string.share_extend_three,
        7 to R.string.share_extend_seven).forEach { (days, label) ->
        TextButton(onClick = { onExtend(extendItem.id, days); extendId = null },
          enabled = state.busyId == null,
          modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("share-extend-$days")) {
          Text(stringResource(label), modifier = Modifier.fillMaxWidth())
        }
      }
    }
  }
  if (revokeItem != null) AlertDialog(onDismissRequest = { revokeId = null },
    title = { Text(stringResource(R.string.share_revoke)) },
    text = { Text(stringResource(R.string.share_revoke_confirm)) },
    confirmButton = { TextButton(onClick = { onRevoke(revokeItem.id); revokeId = null },
      enabled = state.busyId == null, modifier = Modifier.testTag("share-revoke-confirm")) {
      Text(stringResource(R.string.share_revoke), color = MaterialTheme.colorScheme.error)
    } },
    dismissButton = { TextButton(onClick = { revokeId = null }) {
      Text(stringResource(R.string.progress_back))
    } })
  if (previewItem != null) SharePreviewSheet(previewItem, onClose = { previewId = null })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SharePreviewSheet(item: ShareItem, onClose: () -> Unit) {
  val context = LocalContext.current
  var copied by remember(item.id) { mutableStateOf(false) }
  var mode by remember(item.id) { mutableStateOf("summary") }
  ModalBottomSheet(onDismissRequest = onClose, modifier = Modifier.fillMaxHeight(0.92f)
    .testTag("share-preview-sheet")) {
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (mode != "summary") TextButton(onClick = { mode = "summary" },
          modifier = Modifier.testTag("share-preview-back")) {
          Text(stringResource(R.string.progress_back))
        }
        Text(item.title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
        TextButton(onClick = onClose, modifier = Modifier.testTag("share-preview-close")) {
          Text(stringResource(R.string.assistant_close))
        }
      }
      when (mode) {
        "qr" -> Box(Modifier.fillMaxSize().testTag("share-qr-view"), contentAlignment = Alignment.Center) {
          Column(horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val bitmap = remember(item.url) { shareQrBitmap(item.url) }
            Image(bitmap.asImageBitmap(), contentDescription = stringResource(R.string.share_qr),
              modifier = Modifier.size(260.dp).background(androidx.compose.ui.graphics.Color.White))
            Text(item.url, style = MaterialTheme.typography.bodySmall, maxLines = 2)
          }
        }
        "web" -> ShareWebPreview(item.url)
        else -> {
          Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow,
            RoundedCornerShape(16.dp)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(item.url, color = MaterialTheme.colorScheme.primary,
              modifier = Modifier.testTag("share-preview-url"))
            Text(stringResource(when (item.reachability) {
              "public" -> R.string.notes_share_public
              "lan" -> R.string.notes_share_lan
              else -> R.string.notes_share_local
            }))
            if (item.hint.isNotBlank()) Text(item.hint)
            Text(stringResource(R.string.notes_share_expires, shareExpiry(item.expiresAt)))
          }
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = {
              (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                .setPrimaryClip(ClipData.newPlainText(item.title, item.url))
              copied = true
            }, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("share-copy")) {
              Text(stringResource(if (copied) R.string.share_copied else R.string.notes_share_copy))
            }
            TextButton(onClick = { mode = "qr" },
              modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("share-qr")) {
              Text(stringResource(R.string.share_qr))
            }
          }
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { mode = "web" },
              modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("share-web-preview")) {
              Text(stringResource(R.string.share_preview))
            }
            TextButton(onClick = {
              val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, "${item.title}\n${item.url}")
              }
              context.startActivity(Intent.createChooser(send, null))
            }, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("share-system")) {
              Text(stringResource(R.string.notes_share_system))
            }
          }
        }
      }
    }
  }
}

internal fun shareQrBitmap(url: String): Bitmap {
  val bits = QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 260, 260,
    mapOf(EncodeHintType.MARGIN to 1))
  val pixels = IntArray(bits.width * bits.height) { index ->
    if (bits[index % bits.width, index / bits.width]) AndroidColor.BLACK else AndroidColor.WHITE
  }
  return Bitmap.createBitmap(pixels, bits.width, bits.height, Bitmap.Config.ARGB_8888)
}

internal fun shareSameOrigin(candidate: String, original: String): Boolean = try {
  val next = URI(candidate)
  val source = URI(original)
  !next.host.isNullOrBlank() && !source.host.isNullOrBlank() &&
    next.scheme.equals(source.scheme, ignoreCase = true) &&
    next.host.equals(source.host, ignoreCase = true) && next.port == source.port &&
    next.userInfo == null && source.userInfo == null
} catch (_: Exception) { false }

@Composable
private fun ShareWebPreview(url: String) {
  val context = LocalContext.current
  val webView = remember(url) {
    WebView(context).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = false
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.javaScriptCanOpenWindowsAutomatically = false
      settings.setSupportMultipleWindows(false)
      settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
          !shareSameOrigin(request.url.toString(), url)

        @Deprecated("Compatibility with API 26 WebView callbacks")
        override fun shouldOverrideUrlLoading(view: WebView, nextUrl: String): Boolean =
          !shareSameOrigin(nextUrl, url)
      }
    }
  }
  DisposableEffect(webView) {
    onDispose { webView.stopLoading(); webView.destroy() }
  }
  LaunchedEffect(webView, url) { webView.loadUrl(url) }
  AndroidView(factory = { webView }, modifier = Modifier.fillMaxSize().testTag("share-web-view"))
}

@Composable
private fun shareExpiry(value: String): String {
  val locale = LocalConfiguration.current.locales[0]
  return remember(value, locale) {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(locale)
      .withZone(ZoneId.systemDefault()).format(Instant.parse(value))
  }
}
