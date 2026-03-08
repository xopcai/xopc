/**
 * Markdown processing package
 *
 * Provides robust markdown parsing and rendering using Intermediate Representation (IR).
 * Inspired by OpenClaw's approach for reliable markdown handling across different outputs.
 */

// IR parsing and chunking
export {
  markdownToIR,
  markdownToIRWithMeta,
  chunkMarkdownIR,
  type MarkdownIR,
  type MarkdownStyle,
  type MarkdownStyleSpan,
  type MarkdownLinkSpan,
  type MarkdownParseOptions,
} from "./ir.js";

// Rendering
export {
  renderMarkdownWithMarkers,
  type RenderStyleMarker,
  type RenderStyleMap,
  type RenderLink,
  type RenderOptions,
} from "./render.js";

// Table conversion
export { convertMarkdownTables } from "./tables.js";

// Frontmatter parsing
export {
  parseFrontmatterBlock,
  type ParsedFrontmatter,
} from "./frontmatter.js";

// Fence parsing (for code blocks)
export {
  parseFenceSpans,
  findFenceSpanAt,
  isSafeFenceBreak,
  type FenceSpan,
} from "./fences.js";

// Code span tracking
export {
  createInlineCodeState,
  buildCodeSpanIndex,
  type InlineCodeState,
  type CodeSpanIndex,
} from "./code-spans.js";

// Text chunking
export { chunkText } from "./chunk.js";
