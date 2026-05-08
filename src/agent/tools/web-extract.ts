import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { complete, type UserMessage } from '@mariozechner/pi-ai';

import type { Config } from '../../config/schema.js';
import { getDefaultModelSync, resolveModel } from '../../providers/index.js';
import { createLogger } from '../../utils/logger.js';
import { checkUrlSafety, checkWebsiteBlocklist, cleanBase64Images } from './url-safety.js';

const log = createLogger('web-extract');

export const DEFAULT_WEB_EXTRACT_MAX_LENGTH = 15_000;
export const MAX_RAW_HTML_CHARS_FOR_WEB_EXTRACT = 200_000;
const EXTRACTION_TIMEOUT_MS = 30_000;

// Large-document chunked processing thresholds (inspired by hermes-agent)
const MAX_CONTENT_SIZE = 2_000_000;   // 2M chars — refuse entirely above this
const CHUNK_THRESHOLD = 500_000;      // 500k chars — use chunked processing above this
const CHUNK_SIZE = 100_000;           // 100k chars per chunk
const MAX_OUTPUT_SIZE = 15_000;       // Hard cap on final output size

const WebExtractSchema = Type.Object({
  url: Type.String({ description: 'URL to extract content from' }),
  instruction: Type.Optional(
    Type.String({
      description:
        'What to extract or focus on. Examples: "main article text", ' +
        '"pricing table", "API documentation for the auth endpoint". ' +
        'If omitted, extracts the main content.',
    }),
  ),
  maxLength: Type.Optional(
    Type.Number({
      description: 'Maximum characters in the extracted content (default: from config or 15000)',
    }),
  ),
});

export interface WebExtractDeps {
  getConfig: () => Config | undefined;
}

async function fetchPageContent(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; xopc/1.0)',
      Accept: 'text/html,application/xhtml+xml,text/plain,application/json',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json: unknown = await response.json();
    return JSON.stringify(json, null, 2);
  }

  return await response.text();
}

export function stripHtmlBoilerplate(
  html: string,
  maxRaw = MAX_RAW_HTML_CHARS_FOR_WEB_EXTRACT,
): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Remove base64 images early to avoid wasting characters on them
  cleaned = cleanBase64Images(cleaned);
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (cleaned.length > maxRaw) {
    cleaned = cleaned.slice(0, maxRaw) + '\n\n[...truncated]';
  }

  return cleaned;
}

function resolveExtractionModel(config?: Config) {
  const envRef = process.env.XOPC_WEB_EXTRACT_MODEL?.trim();
  const configRef =
    typeof config?.agents?.defaults?.webExtract?.model === 'string'
      ? config.agents.defaults.webExtract.model.trim()
      : '';
  const ref = envRef || configRef;

  if (ref) {
    try {
      return resolveModel(ref);
    } catch {
      /* fall through */
    }
  }

  for (const candidate of ['openai/gpt-4o-mini', 'google/gemini-2.0-flash']) {
    try {
      return resolveModel(candidate);
    } catch {
      /* next */
    }
  }

  return resolveModel(getDefaultModelSync(config));
}

function buildExtractionSystemPrompt(maxLength: number): string {
  return (
    'You are a web content extractor. Given raw HTML/text from a web page, ' +
    'extract the relevant content as clean, well-structured markdown.\n\n' +
    'Rules:\n' +
    '- Remove navigation, headers, footers, ads, cookie banners, sidebars\n' +
    '- Preserve the main content structure (headings, lists, tables, code blocks)\n' +
    '- Keep URLs for important links\n' +
    '- If the page has structured data (tables, specs), preserve the structure\n' +
    `- Keep output under ${maxLength} characters\n` +
    '- If content is truncated, note what was cut\n' +
    '- Output ONLY the extracted content, no meta-commentary'
  );
}

// ---------------------------------------------------------------------------
// LLM call helper — shared by single-pass and chunked extraction
// ---------------------------------------------------------------------------

function buildTimeoutSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(EXTRACTION_TIMEOUT_MS)
      : undefined;
  if (signal && timeoutSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  return signal ?? timeoutSignal;
}

function extractTextFromCompletion(result: { content?: unknown }): string {
  let text = '';
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
        text += String((c as { text?: string }).text || '');
      }
    }
  }
  return text.trim();
}

async function callExtractionLlm(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  config: Config | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const model = resolveExtractionModel(config);
  const userMsg: UserMessage = {
    role: 'user',
    content: `${systemPrompt}\n\n---\n\n${userPrompt}`,
    timestamp: Date.now(),
  };

  const result = await complete(
    model,
    { messages: [userMsg] },
    {
      maxTokens,
      temperature: 0.2,
      signal: buildTimeoutSignal(signal) as AbortSignal,
    },
  );

  return extractTextFromCompletion(result);
}

// ---------------------------------------------------------------------------
// Single-pass extraction (content < CHUNK_THRESHOLD)
// ---------------------------------------------------------------------------

async function extractWithLlm(
  rawContent: string,
  url: string,
  instruction: string | undefined,
  maxLength: number,
  config: Config | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const contentLength = rawContent.length;

  // Refuse absurdly large content
  if (contentLength > MAX_CONTENT_SIZE) {
    const sizeMb = (contentLength / 1_000_000).toFixed(1);
    return (
      `[Content too large to process: ${sizeMb}MB. ` +
      'Try using web_fetch for raw text, or search for a more focused source.]'
    );
  }

  // Route to chunked processing for large documents
  if (contentLength > CHUNK_THRESHOLD) {
    log.info(
      { url, contentLength, chunkSize: CHUNK_SIZE },
      'Large document detected, using chunked extraction',
    );
    return extractLargeDocumentChunked(rawContent, url, instruction, maxLength, config, signal);
  }

  // Standard single-pass extraction
  const systemPrompt = buildExtractionSystemPrompt(maxLength);
  const body = instruction
    ? `Extract from this page (${url}):\n\nFOCUS: ${instruction}\n\n---\n\n${rawContent}`
    : `Extract the main content from this page (${url}):\n\n---\n\n${rawContent}`;

  const text = await callExtractionLlm(
    systemPrompt,
    body,
    Math.min(Math.ceil(maxLength / 3), 8000),
    config,
    signal,
  );

  if (!text) return 'No content could be extracted.';

  const outputCap = Math.min(maxLength, MAX_OUTPUT_SIZE);
  if (text.length > outputCap) {
    return text.slice(0, outputCap) + '\n\n[...output truncated to maxLength]';
  }

  log.debug(
    { url, originalChars: contentLength, extractedChars: text.length },
    'Single-pass extraction complete',
  );
  return text;
}

// ---------------------------------------------------------------------------
// Chunked extraction for large documents (inspired by hermes-agent)
//
// Flow: split → parallel chunk summaries → synthesis pass
// ---------------------------------------------------------------------------

async function extractLargeDocumentChunked(
  content: string,
  url: string,
  instruction: string | undefined,
  maxLength: number,
  config: Config | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  // Split content into chunks
  const chunks: string[] = [];
  for (let offset = 0; offset < content.length; offset += CHUNK_SIZE) {
    chunks.push(content.slice(offset, offset + CHUNK_SIZE));
  }
  log.info({ url, chunkCount: chunks.length, chunkSize: CHUNK_SIZE }, 'Split into chunks');

  // Summarize each chunk in parallel
  const chunkPromises = chunks.map(async (chunk, index) => {
    const chunkLabel = `[Chunk ${index + 1}/${chunks.length}]`;
    try {
      const systemPrompt =
        'You are an expert content analyst processing a SECTION of a larger document. ' +
        'Extract and summarize the key information from THIS SECTION ONLY.\n\n' +
        'Guidelines:\n' +
        '- Do NOT write introductions or conclusions — this is a partial document\n' +
        '- Extract ALL key facts, figures, data points, and insights\n' +
        '- Preserve important quotes, code snippets, and specific details verbatim\n' +
        '- Use bullet points and structured formatting\n' +
        '- Note references to other sections without trying to resolve them';

      const focusLine = instruction ? `\nFOCUS: ${instruction}\n` : '';
      const userPrompt =
        `${chunkLabel} Extract key information from this section of ${url}:` +
        `${focusLine}\n\n${chunk}`;

      const summary = await callExtractionLlm(systemPrompt, userPrompt, 6000, config, signal);
      if (summary) {
        log.debug(
          { url, chunk: index + 1, originalChars: chunk.length, summaryChars: summary.length },
          'Chunk summarized',
        );
      }
      return { index, summary: summary || null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn({ url, chunk: index + 1, error: message }, 'Chunk summarization failed');
      return { index, summary: null };
    }
  });

  const chunkResults = await Promise.all(chunkPromises);

  // Collect successful summaries in order
  const summaries: string[] = [];
  for (const { index, summary } of chunkResults.sort((a, b) => a.index - b.index)) {
    if (summary) {
      summaries.push(`## Section ${index + 1}\n${summary}`);
    }
  }

  if (summaries.length === 0) {
    // All chunks failed — fall back to truncated raw content
    const outputCap = Math.min(maxLength, MAX_OUTPUT_SIZE);
    const truncated = content.slice(0, outputCap);
    return truncated + '\n\n[...all chunk summaries failed; showing truncated raw content]';
  }

  log.info(
    { url, successfulChunks: summaries.length, totalChunks: chunks.length },
    'Chunk summaries collected, synthesizing',
  );

  // Single chunk — return directly
  if (summaries.length === 1) {
    const result = summaries[0];
    const outputCap = Math.min(maxLength, MAX_OUTPUT_SIZE);
    return result.length > outputCap
      ? result.slice(0, outputCap) + '\n\n[...truncated]'
      : result;
  }

  // Synthesize multiple chunk summaries into one cohesive summary
  return synthesizeChunkSummaries(summaries, url, instruction, maxLength, config, signal, content.length);
}

async function synthesizeChunkSummaries(
  summaries: string[],
  url: string,
  instruction: string | undefined,
  maxLength: number,
  config: Config | undefined,
  signal: AbortSignal | undefined,
  originalContentLength: number,
): Promise<string> {
  const outputCap = Math.min(maxLength, MAX_OUTPUT_SIZE);

  const systemPrompt =
    'You synthesize multiple section summaries into one cohesive, comprehensive summary. ' +
    'Remove redundancy, preserve all key facts and actionable information, ' +
    'and organize with clear markdown structure.';

  const focusLine = instruction ? `\nFOCUS: ${instruction}\n` : '';
  const combined = summaries.join('\n\n---\n\n');
  const userPrompt =
    `Synthesize these section summaries from ${url} into ONE unified markdown summary ` +
    `(under ${outputCap} characters):${focusLine}\n\n${combined}`;

  try {
    const synthesized = await callExtractionLlm(systemPrompt, userPrompt, 8000, config, signal);

    if (!synthesized) {
      // Synthesis LLM returned empty — fall back to concatenation
      log.warn({ url }, 'Synthesis returned empty, concatenating chunk summaries');
      const fallback = summaries.join('\n\n');
      return fallback.length > outputCap
        ? fallback.slice(0, outputCap) + '\n\n[...truncated]'
        : fallback;
    }

    const finalOutput = synthesized.length > outputCap
      ? synthesized.slice(0, outputCap) + '\n\n[...summary truncated for context management]'
      : synthesized;

    const compressionRatio = finalOutput.length / originalContentLength;
    log.info(
      {
        url,
        originalChars: originalContentLength,
        extractedChars: finalOutput.length,
        compressionPercent: `${(compressionRatio * 100).toFixed(1)}%`,
      },
      'Chunked extraction complete',
    );

    return finalOutput;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ url, error: message }, 'Synthesis failed, concatenating chunk summaries');
    const fallback = summaries.join('\n\n');
    return fallback.length > outputCap
      ? fallback.slice(0, outputCap) + '\n\n[...truncated due to synthesis failure]'
      : fallback;
  }
}

type WebExtractParams = { url: string; instruction?: string; maxLength?: number };

export function createWebExtractTool(deps: WebExtractDeps): AgentTool {
  return {
    name: 'web_extract',
    label: '📄 Web Extract',
    description:
      'Extract and summarize content from a web page using LLM-powered extraction.\n\n' +
      'Unlike web_fetch (which returns cleaned plain text from HTML), this tool uses a ' +
      'dedicated model pass to produce focused markdown. Use when you need semantic extraction ' +
      'or a specific focus (instruction), not just a single readability pass.\n\n' +
      'WHEN TO USE:\n' +
      '- Reading articles, blog posts, documentation\n' +
      '- Extracting specific data (pricing, specs, API docs)\n' +
      '- Summarizing long pages to save context\n\n' +
      'WHEN TO USE web_fetch INSTEAD:\n' +
      '- Inspecting raw-ish page text quickly without an extra LLM call\n' +
      '- Downloading JSON/API responses\n' +
      '- Debugging page rendering issues',
    parameters: WebExtractSchema,

    async execute(
      _toolCallId: string,
      params: any,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ url: string; extractedLength: number }>> {
      const { url, instruction } = params as WebExtractParams;
      const cfg = deps.getConfig();
      const configuredDefault =
        cfg?.agents?.defaults?.webExtract?.maxLength ?? DEFAULT_WEB_EXTRACT_MAX_LENGTH;
      const maxLength = (params as WebExtractParams).maxLength ?? configuredDefault;

      try {
        // SSRF protection
        const safety = checkUrlSafety(url);
        if (!safety.safe) {
          return {
            content: [{ type: 'text', text: `Blocked: ${safety.reason}` }],
            details: { url, extractedLength: 0 },
          };
        }

        // Website blocklist check
        const blocked = checkWebsiteBlocklist(url, cfg?.tools?.web?.blocklist);
        if (blocked) {
          return {
            content: [{ type: 'text', text: `Blocked: ${blocked.message}` }],
            details: { url, extractedLength: 0 },
          };
        }

        const rawContent = await fetchPageContent(url, signal);
        const cleaned = stripHtmlBoilerplate(rawContent);
        const trimmed = cleaned.trim();
        const looksStructured = trimmed.startsWith('{') || trimmed.startsWith('[');
        if (trimmed.length < 100 && !looksStructured) {
          return {
            content: [
              { type: 'text', text: `Page at ${url} appears to have no extractable content.` },
            ],
            details: { url, extractedLength: 0 },
          };
        }

        const extracted = await extractWithLlm(
          cleaned,
          url,
          instruction,
          maxLength,
          cfg,
          signal,
        );

        return {
          content: [{ type: 'text', text: extracted }],
          details: { url, extractedLength: extracted.length },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn({ url, error: message }, 'web_extract failed');
        return {
          content: [{ type: 'text', text: `Failed to extract content from ${url}: ${message}` }],
          details: { url, extractedLength: 0 },
        };
      }
    },
  } as any;
}
