import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { complete, type UserMessage } from '@mariozechner/pi-ai';

import type { Config } from '../../config/schema.js';
import { getDefaultModelSync, resolveModel } from '../../providers/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('web-extract');

export const DEFAULT_WEB_EXTRACT_MAX_LENGTH = 15_000;
export const MAX_RAW_HTML_CHARS_FOR_WEB_EXTRACT = 200_000;
const EXTRACTION_TIMEOUT_MS = 30_000;

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
      'User-Agent': 'Mozilla/5.0 (compatible; xopcbot/1.0)',
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

  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (cleaned.length > maxRaw) {
    cleaned = cleaned.slice(0, maxRaw) + '\n\n[...truncated]';
  }

  return cleaned;
}

function resolveExtractionModel(config?: Config) {
  const envRef = process.env.XOPCBOT_WEB_EXTRACT_MODEL?.trim();
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

async function extractWithLlm(
  rawContent: string,
  url: string,
  instruction: string | undefined,
  maxLength: number,
  config: Config | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const model = resolveExtractionModel(config);
  const systemPrompt = buildExtractionSystemPrompt(maxLength);
  const body = instruction
    ? `Extract from this page (${url}):\n\nFOCUS: ${instruction}\n\n---\n\n${rawContent}`
    : `Extract the main content from this page (${url}):\n\n---\n\n${rawContent}`;

  const userContent = `${systemPrompt}\n\n---\n\n${body}`;
  const userMsg: UserMessage = { role: 'user', content: userContent, timestamp: Date.now() };

  const timeoutSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(EXTRACTION_TIMEOUT_MS)
      : undefined;
  const mergedSignal =
    signal && timeoutSignal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, timeoutSignal])
      : signal ?? timeoutSignal;

  const result = await complete(
    model,
    { messages: [userMsg] },
    {
      maxTokens: Math.min(Math.ceil(maxLength / 3), 8000),
      temperature: 0.2,
      signal: mergedSignal as AbortSignal,
    },
  );

  let text = '';
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
        text += String((c as { text?: string }).text || '');
      }
    }
  }

  const trimmed = text.trim();
  if (!trimmed) return 'No content could be extracted.';
  if (trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength) + '\n\n[...output truncated to maxLength]';
  }
  return trimmed;
}

export function createWebExtractTool(deps: WebExtractDeps): AgentTool<
  typeof WebExtractSchema,
  { url: string; extractedLength: number }
> {
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
      params: Static<typeof WebExtractSchema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ url: string; extractedLength: number }>> {
      const { url, instruction } = params;
      const cfg = deps.getConfig();
      const configuredDefault =
        cfg?.agents?.defaults?.webExtract?.maxLength ?? DEFAULT_WEB_EXTRACT_MAX_LENGTH;
      const maxLength = params.maxLength ?? configuredDefault;

      try {
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
  };
}
