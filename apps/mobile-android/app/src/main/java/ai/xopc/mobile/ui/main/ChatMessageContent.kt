package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationArtifact
import ai.xopc.mobile.gateway.ConversationMedia
import ai.xopc.mobile.gateway.ConversationMessage
import ai.xopc.mobile.gateway.ConversationReference
import ai.xopc.mobile.gateway.ConversationTarget
import android.content.Intent
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal data class MessagePreviewRequest(val conversationId: String, val media: ConversationMedia,
  val imageGallery: List<ConversationMedia> = emptyList())

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun ChatMessageCard(message: ConversationMessage, onMore: () -> Unit,
  onOpenTarget: (ConversationTarget) -> Unit,
  onOpenPreview: (ConversationMedia, List<ConversationMedia>) -> Unit,
  onOpenLink: (String) -> Unit, onCopy: (String) -> Unit, showMore: Boolean = true,
  previewEligible: Boolean = false, onViewMore: () -> Unit = onMore,
  onOpenExecution: (() -> Unit)? = null,
  onSaveNote: (() -> Unit)? = null,
  loadMedia: (suspend (ConversationMedia) -> ByteArray)? = null) {
  val isUser = message.role == "user"
  val showPreview = previewEligible && messageNeedsPreview(message.role, message.text)
  val voiceOnly = isUser && message.text.isBlank() && message.references.isEmpty() &&
    message.media.size == 1 && mediaPreviewKind(message.media.first()) == "audio"
  BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
    val maxBubbleWidth = maxWidth * 0.9f
    val contentCount = message.media.size + message.references.size + message.targets.size +
      message.outcome?.artifacts.orEmpty().size
    val wideAssistant = !isUser && (message.text.length > 30 || contentCount > 0 || onOpenExecution != null)
    val minimumWidth = if (isUser) when {
      voiceOnly -> 132.dp
      message.media.size == 1 && mediaPreviewKind(message.media.first()) == "audio" -> 180.dp
      contentCount > 1 -> 264.dp
      message.media.any { mediaPreviewKind(it) == "image" } -> 148.dp
      contentCount == 1 -> 220.dp
      else -> 44.dp
    } else 64.dp
    val longestLine = message.text.lineSequence().maxOfOrNull { line ->
      line.sumOf { if (it.code > 255) 16.0 else 8.8 }
    } ?: 0.0
    val estimatedWidth = (longestLine + 30).dp.coerceIn(minimumWidth, 360.dp)
    val bubbleWidth = (if (wideAssistant) maxBubbleWidth else estimatedWidth).coerceAtMost(maxBubbleWidth)
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment =
      if (isUser) Alignment.End else Alignment.Start,
      verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Column(modifier = Modifier.width(bubbleWidth)
      .clip(RoundedCornerShape(18.dp))
      .background(if (isUser) MaterialTheme.colorScheme.primaryContainer
        else MaterialTheme.colorScheme.surface)
      .then(if (isUser) Modifier.combinedClickable(onClick = onMore, onLongClick = onMore)
        .testTag("message-more-${message.id}") else Modifier)
      .padding(horizontal = if (voiceOnly) 4.dp else if (isUser) 14.dp else 16.dp,
        vertical = if (voiceOnly) 0.dp else if (isUser) 10.dp else 14.dp)
      .then(if (isUser) Modifier else Modifier.testTag("message-assistant-card-${message.id}")),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      if (!isUser && onOpenExecution != null) TextButton(onClick = onOpenExecution,
        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)
          .testTag("message-steps-${message.id}")) {
        Text(stringResource(R.string.assistant_execution), modifier = Modifier.weight(1f),
          color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      if (!isUser) MessageReferences(message.references, onOpenTarget)
      if (message.text.isNotBlank()) {
        if (showPreview) MessageTextPreview(message.id, message.text,
          messagePreviewLineLimit(message.role), onViewMore)
        else if (isUser) SelectionContainer {
          Text(message.text, style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 25.sp),
            modifier = Modifier.fillMaxWidth())
        } else RichMessageText(message.text, onOpenLink, onCopy)
      }
      if (isUser) MessageReferences(message.references, onOpenTarget)
      if (message.media.isNotEmpty()) MessageMedia(message.id, message.media, isUser,
        message.text.isNotBlank(), loadMedia) { item, gallery ->
        if (item.uri.startsWith("https://")) onOpenLink(item.uri) else onOpenPreview(item, gallery)
      }
      if (!isUser && (message.outcome?.artifacts?.isNotEmpty() == true ||
        message.targets.isNotEmpty() || message.outcome?.status == "failed")) Column(
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
          .clip(RoundedCornerShape(14.dp))
          .background(MaterialTheme.colorScheme.surfaceContainer)
          .padding(4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        MessageOutcome(message.outcome?.artifacts.orEmpty(), message.outcome?.status,
          message.outcome?.summary, { onOpenPreview(it, emptyList()) }, onOpenLink)
        MessageTargets(message.targets, onOpenTarget)
      }
    }
    if (!isUser && showMore && message.text.isNotBlank()) Row(
      modifier = Modifier.padding(start = 8.dp, top = 2.dp),
      horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      IconButton(onClick = onViewMore, modifier = Modifier.size(44.dp)
        .testTag("message-detail-${message.id}")) {
        Icon(painterResource(R.drawable.tab_notes), stringResource(R.string.assistant_message_detail),
          tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(21.dp))
      }
      if (onSaveNote != null) IconButton(onClick = onSaveNote, modifier = Modifier.size(44.dp)
        .testTag("message-save-note-${message.id}")) {
        Icon(painterResource(R.drawable.message_bookmark),
          stringResource(R.string.assistant_save_note), tint = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.size(21.dp))
      }
      IconButton(onClick = onMore, modifier = Modifier.size(44.dp)
        .testTag("message-more-${message.id}")) {
        Text("⋯", color = MaterialTheme.colorScheme.onSurfaceVariant,
          style = MaterialTheme.typography.headlineMedium)
      }
    }
    }
  }
}

@Composable
private fun MessageTextPreview(messageId: String, text: String, lineLimit: Int, onViewMore: () -> Unit) {
  SelectionContainer {
    Text(plainMessageMarkdown(text).lineSequence().map { line ->
      line.trim().removePrefix("### ").removePrefix("## ").removePrefix("# ")
    }.joinToString("\n").trim(), style = MaterialTheme.typography.bodyLarge,
      maxLines = lineLimit, overflow = TextOverflow.Ellipsis,
      modifier = Modifier.testTag("message-preview-$messageId"))
  }
  TextButton(onClick = onViewMore, modifier = Modifier.heightIn(min = 48.dp)
    .testTag("message-view-more-$messageId")) {
    Text(stringResource(R.string.assistant_view_more))
  }
}

@Composable
private fun MessageReferences(items: List<ConversationReference>, onOpen: (ConversationTarget) -> Unit) {
  if (items.isEmpty()) return
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    items.forEach { item ->
      Card(onClick = { onOpen(ConversationTarget(item.kind, item.sourceId, item.title,
        capabilities = listOf("open"))) }, modifier = Modifier.fillMaxWidth()
        .heightIn(min = 40.dp)
        .testTag("message-reference-${item.kind}-${item.sourceId}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
          verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Icon(painterResource(if (item.kind == "task") R.drawable.tab_progress else R.drawable.tab_notes),
            contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp))
          Text(item.title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
          Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}

@Composable
internal fun RichMessageText(text: String, onOpenLink: (String) -> Unit, onCopy: (String) -> Unit) {
  val fences = Regex("```([A-Za-z0-9_-]*)\\r?\\n?([\\s\\S]*?)```")
  var cursor = 0
  fences.findAll(text).forEach { match ->
    if (match.range.first > cursor) MarkdownParagraphs(text.substring(cursor, match.range.first), onOpenLink)
    val code = match.groupValues[2].trim()
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest),
      modifier = Modifier.fillMaxWidth()) {
      Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (match.groupValues[1].isNotBlank()) Text(match.groupValues[1],
          style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer { Text(code, fontFamily = FontFamily.Monospace,
          style = MaterialTheme.typography.bodySmall) }
        TextButton(onClick = { onCopy(code) }, modifier = Modifier.heightIn(min = 48.dp)) {
          Text(stringResource(R.string.assistant_copy_code))
        }
      }
    }
    cursor = match.range.last + 1
  }
  if (cursor < text.length) MarkdownParagraphs(text.substring(cursor), onOpenLink)
}

@Composable
private fun MarkdownParagraphs(text: String, onOpenLink: (String) -> Unit) {
  val cleaned = text.trim()
  val links = Regex("\\[([^]\\n]{1,240})]\\(([^)\\s]{1,4096})\\)")
  val linkColor = MaterialTheme.colorScheme.primary
  if (cleaned.isNotBlank()) SelectionContainer {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      cleaned.lines().forEach { line ->
        val trimmed = line.trim()
        val display = trimmed.removePrefix("### ").removePrefix("## ").removePrefix("# ")
        val annotated = buildAnnotatedString {
          var cursor = 0
          links.findAll(display).forEach { match ->
            append(display.substring(cursor, match.range.first))
            val url = match.groupValues[2]
            withLink(LinkAnnotation.Url(url,
              TextLinkStyles(style = SpanStyle(color = linkColor))) { onOpenLink(url) }) {
              append(match.groupValues[1])
            }
            cursor = match.range.last + 1
          }
          append(display.substring(cursor))
        }
        if (trimmed.isEmpty()) Spacer(Modifier.height(4.dp)) else Text(
          text = annotated,
          modifier = if (trimmed.startsWith("- ") || trimmed.startsWith("* "))
            Modifier.padding(start = 8.dp) else Modifier,
          style = when {
            trimmed.startsWith("# ") -> MaterialTheme.typography.titleLarge
            trimmed.startsWith("## ") -> MaterialTheme.typography.titleMedium
            trimmed.startsWith("### ") -> MaterialTheme.typography.titleSmall
            else -> MaterialTheme.typography.bodyLarge.copy(lineHeight = 24.sp)
          }, fontWeight = if (trimmed.startsWith('#')) FontWeight.SemiBold else FontWeight.Normal)
      }
    }
  }
}

@Composable
private fun MessageMedia(messageId: String, items: List<ConversationMedia>, isUser: Boolean,
  userHasText: Boolean,
  load: (suspend (ConversationMedia) -> ByteArray)?,
  onOpen: (ConversationMedia, List<ConversationMedia>) -> Unit) {
  val audio = items.filter { mediaPreviewKind(it) == "audio" }
  val images = items.filter { mediaPreviewKind(it) == "image" }
  val attachments = items.filterNot { mediaPreviewKind(it) in setOf("audio", "image") }
  var expanded by remember(messageId, attachments.size) { mutableStateOf(false) }

  audio.forEach { item ->
    Card(onClick = { onOpen(item, emptyList()) }, modifier = Modifier
      .widthIn(max = if (isUser && userHasText) 148.dp else 340.dp)
      .heightIn(min = 48.dp).testTag("message-audio-${item.id}"),
      colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
      Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("▶", style = MaterialTheme.typography.titleMedium)
        Text("▂▄▆▃▅▇", modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1)
        Text(mediaShortSize(item.size), style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }

  if (images.isNotEmpty()) Row(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
    .testTag("message-image-strip-$messageId"),
    horizontalArrangement = if (isUser && images.size == 1) Arrangement.End else Arrangement.spacedBy(8.dp)) {
    images.forEach { item ->
      MessageImageThumbnail(item, if (images.size == 1) 120 else 112, load) { onOpen(item, images) }
    }
  }

  if (attachments.isNotEmpty()) {
    if (!isUser) Text(stringResource(R.string.message_attachments), style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
    (if (expanded) attachments else attachments.take(3)).forEach { item ->
      Card(onClick = { onOpen(item, emptyList()) }, modifier = Modifier.fillMaxWidth()
        .heightIn(min = 48.dp).testTag("message-media-${item.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
          verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Text(mediaSymbol(item), style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
          Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(item.name, maxLines = 1, overflow = TextOverflow.Ellipsis,
              style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(mediaDetail(item.mimeType, item.size), style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
    if (attachments.size > 3) TextButton(onClick = { expanded = !expanded },
      modifier = Modifier.heightIn(min = 48.dp).testTag("message-attachments-toggle-$messageId")) {
      Text(if (expanded) stringResource(R.string.message_fewer_attachments)
        else stringResource(R.string.message_more_attachments, attachments.size - 3))
    }
  }
}

@Composable
private fun MessageImageThumbnail(item: ConversationMedia, size: Int,
  load: (suspend (ConversationMedia) -> ByteArray)?, onOpen: () -> Unit) {
  val result by produceState<Result<ByteArray>?>(initialValue = null, item, load) {
    value = if (load == null) Result.failure(IllegalStateException("MEDIA_UNAVAILABLE"))
    else runCatching { load(item) }
  }
  val payload = result?.getOrNull()
  val bitmap = remember(payload) { payload?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }
  Card(onClick = onOpen, modifier = Modifier.size(size.dp).testTag("message-image-${item.id}"),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
    if (bitmap != null) androidx.compose.foundation.Image(bitmap.asImageBitmap(), item.name,
      modifier = Modifier.fillMaxWidth().height(size.dp).testTag("message-image-thumbnail-${item.id}"),
      contentScale = ContentScale.Crop)
    else Box(modifier = Modifier.fillMaxWidth().height(size.dp), contentAlignment = Alignment.Center) {
      if (result == null) CircularProgressIndicator(modifier = Modifier.size(24.dp))
      else Text("▧", style = MaterialTheme.typography.headlineMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun MessageOutcome(items: List<ConversationArtifact>, status: String?, summary: String?,
  onPreview: (ConversationMedia) -> Unit, onOpenLink: (String) -> Unit) {
  if (items.isEmpty() && status == null) return
  if (status == "failed") Text(stringResource(R.string.message_result_failed),
    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error,
    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
  if (items.isEmpty() && !summary.isNullOrBlank()) Text(summary, style = MaterialTheme.typography.bodySmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant)
  items.forEach { item ->
    val enabled = item.availability == "available" && (item.uri != null || item.shareUrl != null)
    Card(onClick = {
      if (item.uri != null) onPreview(ConversationMedia(item.artifactId, item.title, item.kind,
        item.mimeType.orEmpty(), item.sizeBytes ?: 0, item.uri, item.workspaceRelativePath))
      else item.shareUrl?.let(onOpenLink)
    }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
      .testTag("message-artifact-${item.artifactId}"),
      colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
      Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(painterResource(R.drawable.tab_notes), contentDescription = null,
          tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text(item.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
          if (item.availability != "available") Text(item.availability.replace('_', ' '),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (enabled) Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

@Composable
private fun MessageTargets(items: List<ConversationTarget>, onOpen: (ConversationTarget) -> Unit) {
  items.take(6).forEach { item ->
    Card(onClick = { onOpen(item) }, enabled = "open" in item.capabilities,
      modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
        .testTag("message-target-${item.kind}-${item.id}"),
      colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
      Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(painterResource(if (item.kind == "task") R.drawable.tab_progress else R.drawable.tab_notes),
          contentDescription = null, tint = MaterialTheme.colorScheme.primary,
          modifier = Modifier.size(20.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text(item.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
          item.summary?.let { Text(it, style = MaterialTheme.typography.labelSmall, maxLines = 1,
            overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if ("open" in item.capabilities) Text("›", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

@Composable
internal fun MessageMediaPreview(request: MessagePreviewRequest,
  load: suspend (String, ConversationMedia) -> ByteArray, onClose: () -> Unit) {
  val gallery = request.imageGallery.takeIf { it.isNotEmpty() } ?: listOf(request.media)
  var galleryIndex by remember(request) {
    mutableStateOf(gallery.indexOfFirst { it.id == request.media.id }.coerceAtLeast(0))
  }
  val activeMedia = gallery[galleryIndex]
  val result by produceState<Result<ByteArray>?>(initialValue = null, activeMedia) {
    value = runCatching { load(request.conversationId, activeMedia) }
  }
  Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)
    .testTag("message-media-preview"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Text(activeMedia.name, style = MaterialTheme.typography.titleLarge, maxLines = 2,
      overflow = TextOverflow.Ellipsis)
    Text(mediaDetail(activeMedia.mimeType, activeMedia.size),
      color = MaterialTheme.colorScheme.onSurfaceVariant)
    val payload = result?.getOrNull()
    if (result == null) {
      CircularProgressIndicator(modifier = Modifier.size(28.dp).testTag("message-media-preview-loading"))
    } else if (payload == null) {
      Text(stringResource(R.string.message_preview_unavailable), color = MaterialTheme.colorScheme.error,
        modifier = Modifier.testTag("message-media-preview-error"))
    } else if (previewFileKind(activeMedia.name, activeMedia.mimeType) == PreviewFileKind.SVG) {
      FilePreviewContent(activeMedia.name, activeMedia.mimeType, payload,
        modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp))
    } else if (mediaPreviewKind(activeMedia) == "image") {
      val bitmap = BitmapFactory.decodeByteArray(payload, 0, payload.size)
      if (bitmap != null) androidx.compose.foundation.Image(bitmap.asImageBitmap(), activeMedia.name,
        modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp).clip(RoundedCornerShape(12.dp))
          .testTag("message-media-preview-image"), contentScale = ContentScale.Fit)
      else Text(stringResource(R.string.message_preview_unavailable))
      if (gallery.size > 1) Row(modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = { galleryIndex-- }, enabled = galleryIndex > 0,
          modifier = Modifier.heightIn(min = 48.dp).testTag("message-image-previous")) {
          Text(stringResource(R.string.message_previous_image))
        }
        Text("${galleryIndex + 1} / ${gallery.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick = { galleryIndex++ }, enabled = galleryIndex < gallery.lastIndex,
          modifier = Modifier.heightIn(min = 48.dp).testTag("message-image-next")) {
          Text(stringResource(R.string.message_next_image))
        }
      }
    } else if (mediaPreviewKind(activeMedia) == "audio") {
      AudioMessagePreview(payload, activeMedia)
    } else if (previewFileKind(activeMedia.name, activeMedia.mimeType) != PreviewFileKind.BINARY) {
      FilePreviewContent(activeMedia.name, activeMedia.mimeType, payload,
        modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp))
    } else {
      BinaryMessagePreview(payload, activeMedia)
    }
    Spacer(Modifier.height(4.dp))
    OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
      .testTag("message-media-preview-close")) {
      Text(stringResource(R.string.assistant_close))
    }
  }
}

@Composable
private fun BinaryMessagePreview(payload: ByteArray, media: ConversationMedia) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var error by remember(media.id) { mutableStateOf(false) }
  Column(modifier = Modifier.fillMaxWidth().testTag("message-media-preview-binary"),
    verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Text(mediaSymbol(media), style = MaterialTheme.typography.headlineMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(stringResource(R.string.message_preview_unsupported),
      color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedButton(onClick = {
      scope.launch {
        error = false
        runCatching {
          val file = withContext(Dispatchers.IO) {
            val directory = File(context.cacheDir, "message-media").apply { mkdirs() }
            File.createTempFile("open-", mediaExtension(media.name), directory).apply { writeBytes(payload) }
          }
          val uri = FileProvider.getUriForFile(context, "${context.packageName}.camera-capture", file)
          val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, media.mimeType.ifBlank { "application/octet-stream" })
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          context.startActivity(Intent.createChooser(intent, media.name))
        }.onFailure { error = true }
      }
    }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("message-media-open-system")) {
      Text(stringResource(R.string.message_open_with_app))
    }
    if (error) Text(stringResource(R.string.message_open_with_app_error), color = MaterialTheme.colorScheme.error)
  }
}

private data class AudioPreviewResource(val player: MediaPlayer, val file: File)

@Composable
private fun AudioMessagePreview(payload: ByteArray, media: ConversationMedia) {
  val context = LocalContext.current
  var playing by remember(payload) { mutableStateOf(false) }
  var completed by remember(payload) { mutableStateOf(false) }
  val resource by produceState<Result<AudioPreviewResource>?>(initialValue = null, payload) {
    value = withContext(Dispatchers.IO) { runCatching {
      val directory = File(context.cacheDir, "message-media").apply { mkdirs() }
      val file = File.createTempFile("audio-", mediaExtension(media.name), directory)
      file.writeBytes(payload)
      val player = MediaPlayer().apply { setDataSource(file.absolutePath); prepare() }
      AudioPreviewResource(player, file)
    } }
  }
  val ready = resource?.getOrNull()
  DisposableEffect(ready) {
    ready?.player?.setOnCompletionListener { playing = false; completed = true }
    onDispose {
      runCatching { ready?.player?.release() }
      runCatching { ready?.file?.delete() }
    }
  }
  Column(modifier = Modifier.fillMaxWidth().testTag("message-media-preview-audio"),
    verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp)
      .background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(16.dp))
      .padding(16.dp), verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      Text("▂▄▆▃▅▇", modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
      ready?.let { Text(formatDuration(it.player.duration), style = MaterialTheme.typography.labelMedium) }
    }
    when {
      resource == null -> CircularProgressIndicator(modifier = Modifier.size(28.dp))
      ready == null -> Text(stringResource(R.string.message_preview_unavailable),
        color = MaterialTheme.colorScheme.error)
      else -> OutlinedButton(onClick = {
        if (playing) { ready.player.pause(); playing = false }
        else {
          if (completed) { ready.player.seekTo(0); completed = false }
          ready.player.start(); playing = true
        }
      }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("message-audio-toggle")) {
        Text(stringResource(if (playing) R.string.message_audio_pause else R.string.message_audio_play))
      }
    }
  }
}

private fun mediaDetail(mimeType: String, size: Long): String {
  val type = mimeType.ifBlank { "file" }
  if (size <= 0) return type
  val formatted = if (size >= 1024 * 1024) "%.1f MB".format(size / (1024.0 * 1024.0))
  else if (size >= 1024) "%.1f KB".format(size / 1024.0) else "$size B"
  return "$type · $formatted"
}

private fun mediaShortSize(size: Long): String = when {
  size <= 0 -> ""
  size >= 1024 * 1024 -> "%.1f MB".format(size / (1024.0 * 1024.0))
  size >= 1024 -> "%.1f KB".format(size / 1024.0)
  else -> "$size B"
}

private fun mediaSymbol(media: ConversationMedia): String = when {
  media.mimeType == "application/pdf" || media.name.endsWith(".pdf", ignoreCase = true) -> "PDF"
  media.mimeType.startsWith("video/") -> "▶"
  mediaPreviewKind(media) == "text" -> "TXT"
  else -> "▤"
}

private fun mediaPreviewKind(media: ConversationMedia): String {
  val mimeType = media.mimeType.lowercase()
  val extension = media.name.substringAfterLast('.', "").lowercase()
  return when {
    mimeType.startsWith("image/") || media.type == "image" ||
      extension in setOf("png", "jpg", "jpeg", "gif", "webp", "bmp", "heic") -> "image"
    mimeType.startsWith("audio/") || media.type == "audio" ||
      extension in setOf("mp3", "m4a", "aac", "wav", "ogg", "opus", "flac") -> "audio"
    mimeType.startsWith("text/") || mimeType in setOf("application/json", "application/xml") ||
      extension in setOf("txt", "md", "markdown", "json", "csv", "html", "htm", "xml", "log") -> "text"
    else -> "binary"
  }
}

private fun mediaExtension(name: String): String = name.substringAfterLast('.', "tmp")
  .take(8).filter { it.isLetterOrDigit() }.ifBlank { "tmp" }.let { ".$it" }

private fun formatDuration(milliseconds: Int): String {
  val seconds = (milliseconds.coerceAtLeast(0) / 1000)
  return "%d:%02d".format(seconds / 60, seconds % 60)
}
