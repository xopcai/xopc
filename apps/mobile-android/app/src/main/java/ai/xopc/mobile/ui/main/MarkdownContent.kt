package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text as MarkdownTextNode
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser
import org.commonmark.parser.IncludeSourceSpans
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val markdownParser = Parser.builder().extensions(listOf(
  TablesExtension.create(), StrikethroughExtension.create()))
  .customBlockParserFactory(MathBlockParser.Factory())
  .includeSourceSpans(IncludeSourceSpans.BLOCKS_AND_INLINES).build()

private val LocalMarkdownSource = androidx.compose.runtime.compositionLocalOf { "" }
private val LocalStreamingMarkdown = androidx.compose.runtime.compositionLocalOf { false }
private val LocalMathEnabled = androidx.compose.runtime.compositionLocalOf { true }

internal data class MarkdownRenderBlock(val id: String, val node: Node, val fingerprint: String)

internal fun projectMarkdown(source: String, previous: List<MarkdownRenderBlock> = emptyList()): List<MarkdownRenderBlock> {
  val retained = previous.associateBy { it.id }
  return markdownParser.parse(source).children().mapIndexed { index, node ->
    val id = node.sourceSpans.firstOrNull()?.inputIndex?.let { "source:$it" } ?: "unpositioned:$index"
    val fingerprint = buildString { appendMarkdownFingerprint(node) }
    retained[id]?.takeIf { it.fingerprint == fingerprint } ?: MarkdownRenderBlock(id, node, fingerprint)
  }
}

private fun StringBuilder.appendMarkdownFingerprint(node: Node) {
  append(node.javaClass.name).append(':')
  append(when (node) {
    is MathSourceBlock -> node.source
    is MarkdownTextNode -> node.literal
    is Code -> node.literal
    is FencedCodeBlock -> node.info + ":" + node.literal
    is IndentedCodeBlock -> node.literal
    is HtmlBlock -> node.literal
    is HtmlInline -> node.literal
    is Heading -> node.level
    is OrderedList -> node.markerStartNumber
    is Link -> node.destination + ":" + node.title
    is Image -> node.destination + ":" + node.title
    is TableCell -> "${node.isHeader}:${node.alignment}"
    else -> ""
  }).append('\u0000')
  node.children().forEach { appendMarkdownFingerprint(it) }
  append('\u0001')
}

/** Shared native Markdown renderer for messages, previews, and document content. */
@Composable
internal fun MarkdownContent(markdown: String, modifier: Modifier = Modifier,
  maxLines: Int? = null, onOpenLink: ((String) -> Unit)? = null,
  onCopyCode: ((String) -> Unit)? = null, streaming: Boolean = false) {
  val document by produceState<List<MarkdownRenderBlock>>(emptyList(), markdown) {
    val previous = value
    value = withContext(Dispatchers.Default) { projectMarkdown(markdown, previous) }
  }
  val linkColor = MaterialTheme.colorScheme.primary
  val mathEnabled = remember(markdown) { MathMarkdownSyntax.candidateCount(markdown) <= 256 }
  if (maxLines != null) {
    val preview = remember(document, linkColor, onOpenLink) {
      buildAnnotatedString { document.forEach { appendPreview(it.node, linkColor, onOpenLink) } }
    }
    SelectionContainer {
      Text(preview, modifier = modifier,
        style = MaterialTheme.typography.bodyLarge, maxLines = maxLines,
        overflow = TextOverflow.Ellipsis)
    }
  } else {
    Column(modifier = modifier.testTag("markdown-content"),
      verticalArrangement = Arrangement.spacedBy(8.dp)) {
      document.forEach { block ->
        key(block.id) {
          androidx.compose.runtime.CompositionLocalProvider(LocalMarkdownSource provides markdown, LocalMathEnabled provides mathEnabled, LocalStreamingMarkdown provides
            (streaming && block.id == document.lastOrNull()?.id && block.node !is TableBlock)) {
            MarkdownBlock(block.node, linkColor, onOpenLink, onCopyCode)
          }
        }
      }
    }
  }
}

@Composable
private fun MarkdownBlock(node: Node, linkColor: Color,
  onOpenLink: ((String) -> Unit)?, onCopyCode: ((String) -> Unit)?) {
  when (node) {
    is MathSourceBlock -> MathMarkdownView(node.source, LocalStreamingMarkdown.current, display = true, enabled = LocalMathEnabled.current, onCopy = onCopyCode)
    is Paragraph -> MarkdownInlineText(node, linkColor, onOpenLink,
      modifier = Modifier.fillMaxWidth().testTag("markdown-paragraph"))
    is Heading -> MarkdownInlineText(node, linkColor, onOpenLink,
      modifier = Modifier.fillMaxWidth().testTag("markdown-heading"),
      style = when (node.level) {
        1 -> MaterialTheme.typography.bodyLarge.copy(fontSize = 24.sp, lineHeight = 32.sp)
        2 -> MaterialTheme.typography.bodyLarge.copy(fontSize = 20.sp, lineHeight = 28.sp)
        3 -> MaterialTheme.typography.bodyLarge.copy(fontSize = 18.sp, lineHeight = 26.sp)
        else -> MaterialTheme.typography.bodyLarge.copy(lineHeight = 24.sp)
      }, bold = true)
    is FencedCodeBlock -> if (node.info.trim() == "math") {
      val raw = LocalMarkdownSource.current
      val text = node.sourceSpans.map { raw.substring(it.inputIndex, (it.inputIndex + it.length).coerceAtMost(raw.length)) }.joinToString("\n")
      MathMarkdownView(text, LocalStreamingMarkdown.current, display = true, enabled = LocalMathEnabled.current, onCopy = onCopyCode)
    } else MarkdownCodeBlock(node.literal, node.info, onCopyCode)
    is IndentedCodeBlock -> MarkdownCodeBlock(node.literal, "", onCopyCode)
    is BulletList, is OrderedList -> MarkdownList(node, linkColor, onOpenLink, onCopyCode)
    is BlockQuote -> Column(modifier = Modifier.fillMaxWidth()
      .border(width = 2.dp, color = MaterialTheme.colorScheme.outlineVariant,
        shape = RoundedCornerShape(2.dp))
      .padding(start = 12.dp, top = 8.dp, end = 8.dp, bottom = 8.dp)
      .testTag("markdown-quote"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      node.children().forEach { MarkdownBlock(it, linkColor, onOpenLink, onCopyCode) }
    }
    is TableBlock -> MarkdownTable(node, linkColor, onOpenLink)
    is ThematicBreak -> HorizontalDivider()
    is HtmlBlock -> SelectionContainer { Text(node.literal) }
    else -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      node.children().forEach { MarkdownBlock(it, linkColor, onOpenLink, onCopyCode) }
    }
  }
}

@Composable
private fun MarkdownInlineText(node: Node, linkColor: Color,
  onOpenLink: ((String) -> Unit)?, modifier: Modifier = Modifier,
  style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.bodyLarge.copy(lineHeight = 24.sp),
  bold: Boolean = false, prefix: String = "") {
  val rawSource = LocalMarkdownSource.current
  val original = node.sourceSpans.map { rawSource.substring(it.inputIndex.coerceAtMost(rawSource.length), (it.inputIndex + it.length).coerceAtMost(rawSource.length)) }.joinToString("\n")
  if (MathMarkdownSyntax.mayContain(original)) {
    MathMarkdownView(prefix + original, LocalStreamingMarkdown.current, modifier, fontSize = style.fontSize.value,
      enabled = LocalMathEnabled.current, onOpenLink = onOpenLink)
    return
  }
  val content = remember(node, linkColor, onOpenLink, prefix) {
    buildAnnotatedString {
      append(prefix)
      node.children().forEach { appendInline(it, linkColor, onOpenLink) }
    }
  }
  val readingStyle = if (prefix.isNotEmpty()) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val markerWidth = remember(prefix, style, density) {
      with(density) { measurer.measure(AnnotatedString(prefix), style).size.width.toSp() }
    }
    style.copy(textIndent = TextIndent(firstLine = 0.sp, restLine = markerWidth))
  } else style
  SelectionContainer {
    StreamingMarkdownText(content, LocalStreamingMarkdown.current, modifier, readingStyle,
      if (bold) FontWeight.SemiBold else null)
  }
}

@Composable
private fun MarkdownCodeBlock(code: String, info: String, onCopyCode: ((String) -> Unit)?) {
  val language = info.substringBefore(' ').trim()
  var expanded by remember { mutableStateOf(false) }
  val raw = code.trimEnd('\n', '\r')
  val preview = remember(raw) { markdownCodePreview(raw) }
  Card(modifier = Modifier.fillMaxWidth().testTag("markdown-code-block"),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest)) {
    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      if (language.isNotEmpty() || onCopyCode != null) Row(
        modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        if (language.isNotEmpty()) Text(language, style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (onCopyCode != null) TextButton(onClick = { onCopyCode(code.trimEnd('\n', '\r')) }) {
          Text(stringResource(R.string.assistant_copy_code))
        }
      }
      SelectionContainer {
        Text(if (expanded) raw else preview, modifier = Modifier.horizontalScroll(rememberScrollState())
          .testTag("markdown-code-text"), fontFamily = FontFamily.Monospace,
          style = MaterialTheme.typography.bodySmall, softWrap = false)
      }
      if (preview.length < raw.length) TextButton(onClick = { expanded = !expanded }) {
        Text(stringResource(if (expanded) R.string.message_collapse_content else R.string.assistant_view_more))
      }
    }
  }
}

@Composable
private fun MarkdownList(node: Node, linkColor: Color,
  onOpenLink: ((String) -> Unit)?, onCopyCode: ((String) -> Unit)?, depth: Int = 0) {
  val start = (node as? OrderedList)?.markerStartNumber ?: 1
  // Only nesting adds a gutter; continuation lines align after the native marker width.
  val indentation = (depth.coerceAtMost(3) * 12).dp
  Column(verticalArrangement = Arrangement.spacedBy(4.dp),
    modifier = Modifier.fillMaxWidth().testTag("markdown-list")) {
    node.children().filterIsInstance<ListItem>().forEachIndexed { index, item ->
      val marker = if (node is OrderedList) "${start + index}. " else "• "
      item.children().forEachIndexed { childIndex, child ->
        when (child) {
          is BulletList, is OrderedList -> MarkdownList(child, linkColor, onOpenLink,
            onCopyCode, depth + 1)
          is Paragraph -> MarkdownInlineText(child, linkColor, onOpenLink,
            modifier = Modifier.fillMaxWidth().padding(start = indentation)
              .testTag("markdown-list-paragraph"),
            prefix = if (childIndex == 0) marker else "")
          else -> Column(modifier = Modifier.fillMaxWidth().padding(start = indentation)) {
            if (childIndex == 0) Text(marker.trimEnd(), style = MaterialTheme.typography.bodyLarge)
            MarkdownBlock(child, linkColor, onOpenLink, onCopyCode)
          }
        }
      }
    }
  }
}

@Composable
private fun MarkdownTable(node: TableBlock, linkColor: Color,
  onOpenLink: ((String) -> Unit)?) {
  var expanded by remember { mutableStateOf(false) }
  val rows = remember(node) { node.children().flatMap { it.children() } }
  Column {
  Column(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
    .testTag("markdown-table")) {
    (if (expanded) rows else rows.take(40)).forEach { row ->
      Row {
        row.children().filterIsInstance<TableCell>().forEach { cell ->
          val content = remember(cell, linkColor, onOpenLink) {
            buildAnnotatedString { cell.children().forEach { appendInline(it, linkColor, onOpenLink) } }
          }
          SelectionContainer {
            Text(content, modifier = Modifier.widthIn(min = 168.dp, max = 168.dp)
              .border(1.dp, MaterialTheme.colorScheme.outlineVariant)
              .padding(8.dp), style = MaterialTheme.typography.bodySmall,
              textAlign = when (cell.alignment) {
                TableCell.Alignment.CENTER -> TextAlign.Center
                TableCell.Alignment.RIGHT -> TextAlign.End
                else -> TextAlign.Start
              },
              fontWeight = if (cell.isHeader) FontWeight.SemiBold else null)
          }
        }
      }
    }
  }
  if (rows.size > 40) TextButton(onClick = { expanded = !expanded }) {
    Text(stringResource(if (expanded) R.string.message_collapse_content else R.string.assistant_view_more))
  }
  }
}

internal fun markdownCodePreview(source: String, lines: Int = 40): String {
  var cursor = 0
  repeat(lines) { index ->
    val end = source.indexOf('\n', cursor)
    if (end < 0) return source
    if (index == lines - 1) return source.substring(0, end)
    cursor = end + 1
  }
  return source
}

private fun AnnotatedString.Builder.appendInline(node: Node, linkColor: Color,
  onOpenLink: ((String) -> Unit)?) {
  when (node) {
    is MarkdownTextNode -> append(node.literal)
    is Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 0.9.em,
      background = Color.Gray.copy(alpha = 0.12f))) { append(node.literal) }
    is Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
      node.children().forEach { appendInline(it, linkColor, onOpenLink) }
    }
    is StrongEmphasis -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
      node.children().forEach { appendInline(it, linkColor, onOpenLink) }
    }
    is Strikethrough -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
      node.children().forEach { appendInline(it, linkColor, onOpenLink) }
    }
    is Link -> if (onOpenLink != null && safeMarkdownLink(node.destination)) {
      withLink(LinkAnnotation.Url(node.destination,
        TextLinkStyles(style = SpanStyle(color = linkColor,
          textDecoration = TextDecoration.Underline))) { onOpenLink(node.destination) }) {
        node.children().forEach { appendInline(it, linkColor, onOpenLink) }
      }
    } else node.children().forEach { appendInline(it, linkColor, onOpenLink) }
    is Image -> node.children().forEach { appendInline(it, linkColor, onOpenLink) }
    is SoftLineBreak -> append(' ')
    is HardLineBreak -> append('\n')
    is HtmlInline -> append(node.literal)
    else -> node.children().forEach { appendInline(it, linkColor, onOpenLink) }
  }
}

private fun AnnotatedString.Builder.appendPreview(node: Node, linkColor: Color,
  onOpenLink: ((String) -> Unit)?) {
  when (node) {
    is FencedCodeBlock -> append(node.literal.trim())
    is IndentedCodeBlock -> append(node.literal.trim())
    is OrderedList -> node.children().forEachIndexed { index, child ->
      append("${(node.markerStartNumber ?: 1) + index}. ")
      appendPreview(child, linkColor, onOpenLink)
    }
    is BulletList -> node.children().forEach { child ->
      append("• "); appendPreview(child, linkColor, onOpenLink)
    }
    is Heading -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
      node.children().forEach { appendInline(it, linkColor, onOpenLink) }
    }
    is Paragraph -> node.children().forEach { appendInline(it, linkColor, onOpenLink) }
    else -> node.children().forEach { appendPreview(it, linkColor, onOpenLink) }
  }
  if (node is Paragraph || node is Heading || node is FencedCodeBlock || node is IndentedCodeBlock)
    append('\n')
}

private fun safeMarkdownLink(url: String): Boolean = externalMessageLink(url) || messageLinkTarget(url) != null

private fun Node.children(): List<Node> = buildList {
  var child = firstChild
  while (child != null) { add(child); child = child.next }
}
