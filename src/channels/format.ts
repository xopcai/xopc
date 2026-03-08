/**
 * Telegram Message Formatting Utilities
 *
 * Re-exports from telegram-format.ts for backward compatibility.
 * All implementations now use the robust @src/markdown/ package.
 */

// Re-export everything from the new telegram-format module
export {
  // Core formatting functions
  escapeHtml,
  escapeHtmlAttr,
  markdownToTelegramHtml,
  markdownToPlainText,
  wrapFileReferencesInHtml,
  formatTelegramMessage,
  splitTelegramMessage,
  splitTelegramMessageSmart,
  isValidTelegramHtml,
  fixMalformedHtml,
  // IR-based functions
  markdownToTelegramChunks,
  renderTelegramHtmlText,
  renderIRToTelegramHtml,
  // Types
  type FormattedChunk,
} from "./telegram-format.js";

// Re-export from markdown package for advanced use cases
export {
  markdownToIR,
  markdownToIRWithMeta,
  chunkMarkdownIR,
  type MarkdownIR,
  type MarkdownStyle,
  type MarkdownStyleSpan,
  type MarkdownLinkSpan,
  type MarkdownParseOptions,
} from "../markdown/index.js";
