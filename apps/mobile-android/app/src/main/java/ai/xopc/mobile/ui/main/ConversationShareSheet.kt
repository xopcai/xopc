package ai.xopc.mobile.ui.main

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ai.xopc.mobile.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ConversationShareSheet(state: ConnectionUiState, onReload: (String) -> Unit,
  onCreate: (Long, List<String>) -> Unit, onRevoke: () -> Unit, onDismiss: () -> Unit) {
  val snapshot = state.conversationSharePreview
  val share = state.conversationShareResult
  val conversationId = state.conversationShareId ?: snapshot?.conversationId ?: share?.conversationId ?: return
  val busy = state.conversationShareBusy
  val currentBusy by rememberUpdatedState(busy)
  val context = LocalContext.current
  val uriHandler = LocalUriHandler.current
  var preview by rememberSaveable(conversationId) { mutableStateOf(false) }
  var attachmentsOpen by rememberSaveable(conversationId) { mutableStateOf(false) }
  var expiryOpen by remember(conversationId) { mutableStateOf(false) }
  var ttl by rememberSaveable(conversationId) { mutableLongStateOf(86_400_000) }
  var selected by rememberSaveable(conversationId) { mutableStateOf(arrayListOf<String>()) }
  var confirmRevoke by rememberSaveable(conversationId) { mutableStateOf(false) }
  var copied by rememberSaveable(share?.id) { mutableStateOf(false) }
  var openError by rememberSaveable(share?.id) { mutableStateOf(false) }
  val eligible = snapshot?.attachments.orEmpty().filter { it.id in selected }
  val duration = when (ttl) {
    3_600_000L -> R.string.session_share_hour
    604_800_000L -> R.string.session_share_week
    2_592_000_000L -> R.string.session_share_month
    else -> R.string.session_share_day
  }
  ModalBottomSheet(
    onDismissRequest = { if (!busy) onDismiss() },
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true,
      confirmValueChange = { it != SheetValue.Hidden || !currentBusy }),
    modifier = Modifier.testTag("conversations-share-sheet"),
  ) {
    LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 20.dp),
      contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      item {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          Text(stringResource(when {
            preview -> R.string.share_preview
            share != null -> R.string.session_share_link
            state.conversationShareRevoked -> R.string.session_share_revoked
            else -> R.string.conversations_share
          }), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
          TextButton(enabled = !busy, onClick = { if (preview) preview = false else onDismiss() }) {
            Text(stringResource(if (preview) R.string.progress_back else R.string.assistant_close))
          }
        }
      }
      if (state.conversationShareError || openError) item {
        Text(stringResource(R.string.session_share_error), color = MaterialTheme.colorScheme.error)
        if (share == null) TextButton(onClick = { onReload(conversationId) }) {
          Text(stringResource(R.string.assistant_retry))
        }
      }
      if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth().testTag("conversations-share-loading")) }
      when {
        share != null -> {
          item {
            ShareSnapshotCard(share.title, share.messageCount, share.attachmentCount)
          }
          item {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
              Text(share.url, Modifier.testTag("conversations-share-url"), color = MaterialTheme.colorScheme.primary)
              val expires = runCatching {
                DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())
                  .format(Instant.parse(share.expiresAt))
              }.getOrDefault(share.expiresAt)
              Text(stringResource(R.string.notes_share_expires, expires))
              if (share.reachability != "public") Text(stringResource(
                if (share.reachability == "lan") R.string.notes_share_lan else R.string.notes_share_local),
                style = MaterialTheme.typography.bodySmall)
            }
          }
          item {
            Button(enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("conversations-share-copy"), onClick = {
              val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
              clipboard.setPrimaryClip(ClipData.newPlainText(share.title, share.url))
              copied = true
            }) { Text(stringResource(if (copied) R.string.share_copied else R.string.notes_share_copy)) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              TextButton(enabled = !busy, onClick = {
                runCatching { uriHandler.openUri(share.url) }.onFailure { openError = true }
              }) { Text(stringResource(R.string.session_share_open)) }
              TextButton(enabled = !busy, modifier = Modifier.testTag("conversations-share-system"), onClick = {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, share.url)
                context.startActivity(Intent.createChooser(send, null))
              }) { Text(stringResource(R.string.notes_share_system)) }
            }
            TextButton(enabled = !busy, onClick = { confirmRevoke = true },
              modifier = Modifier.testTag("conversations-share-revoke")) {
              Text(stringResource(R.string.share_revoke), color = MaterialTheme.colorScheme.error)
            }
          }
        }
        state.conversationShareRevoked -> item {
          Button(onClick = { selected = arrayListOf(); ttl = 86_400_000; onReload(conversationId) },
            modifier = Modifier.testTag("conversations-share-again")) {
            Text(stringResource(R.string.session_share_new))
          }
        }
        snapshot != null && preview -> {
          item { ShareSnapshotCard(snapshot.title, snapshot.messageCount, eligible.size) }
          items(snapshot.messages, key = { it.id }) { message ->
            Box(Modifier.fillMaxWidth(), contentAlignment =
              if (message.role == "user") Alignment.CenterEnd else Alignment.CenterStart) {
              Surface(shape = MaterialTheme.shapes.medium, color = if (message.role == "user")
                MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
                modifier = Modifier.fillParentMaxWidth(0.9f)) {
                Text(message.markdown, Modifier.padding(12.dp))
              }
            }
          }
          items(eligible, key = { "file-" + it.id }) { Text(it.fileName) }
        }
        snapshot != null -> {
          item {
            ShareSnapshotCard(snapshot.title, snapshot.messageCount, eligible.size) {
              TextButton(enabled = !busy, onClick = { preview = true }) {
                Text(stringResource(R.string.share_preview))
              }
            }
          }
          if (snapshot.attachments.isNotEmpty()) {
            item {
              TextButton(enabled = !busy, onClick = { attachmentsOpen = !attachmentsOpen },
                modifier = Modifier.testTag("conversations-share-attachments")) {
                Text(stringResource(R.string.session_share_attachments, eligible.size))
              }
            }
            if (attachmentsOpen) items(snapshot.attachments, key = { it.id }) { file ->
              Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(file.id in selected, { checked ->
                  selected = ArrayList(if (checked) selected + file.id else selected - file.id)
                }, enabled = !busy, modifier = Modifier.testTag("conversations-share-file-${file.id}"))
                Text(file.fileName)
              }
            }
          }
          item {
            Box {
              TextButton(enabled = !busy, onClick = { expiryOpen = true },
                modifier = Modifier.testTag("conversations-share-expiry")) {
                Text(stringResource(R.string.session_share_duration, stringResource(duration)))
              }
              DropdownMenu(expiryOpen, { expiryOpen = false }) {
                listOf(3_600_000L to R.string.session_share_hour, 86_400_000L to R.string.session_share_day,
                  604_800_000L to R.string.session_share_week, 2_592_000_000L to R.string.session_share_month).forEach { (ms, label) ->
                  DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = { ttl = ms; expiryOpen = false },
                    modifier = Modifier.testTag("conversations-share-expiry-$ms"))
                }
              }
            }
            Text(stringResource(R.string.session_share_disclosure), style = MaterialTheme.typography.bodySmall)
            Button(enabled = !busy && !state.conversationShareError && snapshot.messageCount > 0,
              onClick = { onCreate(ttl, eligible.map { it.id }) },
              modifier = Modifier.fillMaxWidth().testTag("conversations-share-confirm")) {
              Text(stringResource(R.string.session_share_create))
            }
          }
        }
      }
    }
  }
  if (confirmRevoke) AlertDialog(onDismissRequest = { confirmRevoke = false },
    title = { Text(stringResource(R.string.share_revoke)) },
    text = { Text(stringResource(R.string.session_share_revoke_help)) },
    confirmButton = { TextButton(onClick = { confirmRevoke = false; onRevoke() },
      modifier = Modifier.testTag("conversations-share-revoke-confirm")) { Text(stringResource(R.string.share_revoke)) } },
    dismissButton = { TextButton(onClick = { confirmRevoke = false }) { Text(stringResource(R.string.conversations_cancel)) } })
}

@Composable
private fun ShareSnapshotCard(title: String, messages: Int, attachments: Int, action: @Composable () -> Unit = {}) {
  Card(Modifier.fillMaxWidth()) {
    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.session_share_count, messages, attachments),
          style = MaterialTheme.typography.bodySmall)
      }
      action()
    }
  }
}
