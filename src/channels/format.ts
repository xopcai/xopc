/**
 * Generic markdown utilities for channel code paths.
 * Telegram-specific HTML rendering lives in `./telegram/format.js`.
 */

export {
  markdownToIR,
  markdownToIRWithMeta,
  chunkMarkdownIR,
  type MarkdownIR,
  type MarkdownStyle,
  type MarkdownStyleSpan,
  type MarkdownLinkSpan,
  type MarkdownParseOptions,
  renderMarkdownWithMarkers,
  type RenderStyleMarker,
  type RenderStyleMap,
  type RenderLink,
  type RenderOptions,
  convertMarkdownTables,
  parseFrontmatterBlock,
  type ParsedFrontmatter,
  parseFenceSpans,
  findFenceSpanAt,
  isSafeFenceBreak,
  type FenceSpan,
  createInlineCodeState,
  buildCodeSpanIndex,
  type InlineCodeState,
  type CodeSpanIndex,
  chunkText,
} from '../markdown/index.js';
