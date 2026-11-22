import type { Hono } from 'hono';
import { z } from 'zod';

import { resolveEffectiveImageModelConfig } from '../../../agent/image/tool-model-config.js';
import { describeImagesWithFallback } from '../../../agent/image/understanding/runtime.js';
import { createLogger } from '../../../utils/logger.js';

import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('Hono:ScreenshotAi');

const MAX_BASE64_LENGTH = 22 * 1024 * 1024; // ~16 MB binary image

const AnalyzeRequestSchema = z.object({
  mode: z.enum(['ocr', 'translate']),
  imageBase64: z.string().min(16).max(MAX_BASE64_LENGTH),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional().default('image/png'),
  targetLanguage: z.enum(['auto', 'zh', 'en']).optional().default('auto'),
});

const OCR_SYSTEM_PROMPT = `Extract all visible text from the screenshot accurately.
Rules:
- Preserve original line breaks, indentation, bullet lists, and reading order.
- Format tables as clean GitHub-flavored Markdown tables and mathematical formulas in LaTeX when present.
- Output ONLY the extracted text without commentary, preambles, or code fences wrapping the entire response.`;

function buildTranslatePrompt(targetLanguage: 'auto' | 'zh' | 'en'): string {
  const targetInstruction =
    targetLanguage === 'zh'
      ? 'Translate all extracted text into Simplified Chinese (zh-CN).'
      : targetLanguage === 'en'
        ? 'Translate all extracted text into natural English (en).'
        : 'Detect the primary language in the image: if it is mostly Chinese, translate into natural English (en); otherwise translate into Simplified Chinese (zh-CN).';

  return `Read all visible text in the screenshot and translate it accurately.
${targetInstruction}
Return strict JSON (no markdown fences) with this exact shape:
{
  "targetLanguage": "zh-CN or en",
  "sourceText": "full extracted original text",
  "translatedText": "full translated text preserving structure",
  "items": [
    { "source": "original paragraph/line", "translation": "translated paragraph/line" }
  ]
}`;
}

export function parseTranslationModelOutput(
  raw: string,
  fallbackTarget: string,
): {
  targetLanguage: string;
  sourceText: string;
  translatedText: string;
  items: Array<{ source: string; translation: string }>;
} {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      targetLanguage?: unknown;
      sourceText?: unknown;
      translatedText?: unknown;
      items?: unknown;
    };
    const translatedText = typeof parsed.translatedText === 'string' ? parsed.translatedText.trim() : '';
    const sourceText = typeof parsed.sourceText === 'string' ? parsed.sourceText.trim() : '';
    const targetLanguage =
      typeof parsed.targetLanguage === 'string' && parsed.targetLanguage.trim()
        ? parsed.targetLanguage.trim()
        : fallbackTarget;
    const items = Array.isArray(parsed.items)
      ? parsed.items.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const src = (entry as Record<string, unknown>)['source'];
          const tr = (entry as Record<string, unknown>)['translation'];
          return typeof src === 'string' && typeof tr === 'string' ? [{ source: src, translation: tr }] : [];
        })
      : [];
    if (translatedText || sourceText) {
      return { targetLanguage, sourceText, translatedText: translatedText || cleaned, items };
    }
  } catch {
    /* fallback when model returns plain text */
  }
  return {
    targetLanguage: fallbackTarget,
    sourceText: '',
    translatedText: cleaned,
    items: [],
  };
}

export function registerScreenshotAiRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.post('/api/screenshot/analyze', deps.chatRateLimitMiddleware, async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    const parsed = AnalyzeRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'Invalid screenshot analysis request' }, 400);
    }

    const { mode, imageBase64, mimeType, targetLanguage } = parsed.data;
    const stripped = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    const buffer = Buffer.from(stripped, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > 16 * 1024 * 1024) {
      return c.json({ ok: false, error: 'Screenshot payload must be between 1 byte and 16 MB' }, 400);
    }

    const modelConfig = resolveEffectiveImageModelConfig({ cfg: deps.service.currentConfig });
    if (!modelConfig?.primary) {
      return c.json(
        {
          ok: false,
          error: 'NO_VISION_MODEL: Configure a vision-capable model in Models settings to use AI OCR or translation.',
        },
        409,
      );
    }

    const startedAt = Date.now();
    try {
      const prompt = mode === 'ocr' ? OCR_SYSTEM_PROMPT : buildTranslatePrompt(targetLanguage);
      const outcome = await describeImagesWithFallback({
        modelRef: modelConfig.primary,
        fallbacks: modelConfig.fallbacks,
        images: [{ buffer, mimeType }],
        prompt,
        maxTokens: 2048,
        timeoutMs: 45_000,
        signal: c.req.raw.signal,
      });

      const resolvedModel = `${outcome.provider}/${outcome.model}`;
      log.info(
        {
          phase: 'screenshot_analyze',
          mode,
          modelRef: resolvedModel,
          durationMs: Date.now() - startedAt,
          bytes: buffer.byteLength,
        },
        `Screenshot ${mode} completed via ${resolvedModel}`,
      );

      if (mode === 'ocr') {
        return c.json({
          ok: true,
          mode: 'ocr',
          engine: 'ai',
          text: outcome.text.trim(),
          model: resolvedModel,
        });
      }

      const structured = parseTranslationModelOutput(
        outcome.text,
        targetLanguage === 'auto' ? 'zh-CN' : targetLanguage,
      );
      return c.json({
        ok: true,
        mode: 'translate',
        ...structured,
        model: resolvedModel,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn(
        { err: err instanceof Error ? err : undefined, errorMessage, phase: 'screenshot_analyze', mode },
        `Screenshot ${mode} failed: ${errorMessage}`,
      );
      return c.json({ ok: false, error: errorMessage }, 502);
    }
  });
}
