/**
 * Local CLI TTS extension.
 *
 * Spawns any local TTS binary (mlx-audio, sherpa-onnx-tts, piper, ...) and
 * reads back the generated audio file. Useful when:
 *   - The user runs an offline / on-device model and doesn't want HTTP egress.
 *   - The user wants to wire a custom voice (cloned, fine-tuned) through a
 *     shell pipeline without writing a full SpeechProviderPlugin.
 *
 * Ported from openclaw/extensions/tts-local-cli (commit baseline 2026-05-08),
 * with the following INTENTIONAL OMISSIONS per docs/voice-rearchitecture.md §15.3:
 *   - synthesizeTelephony surface (talk/persona excluded from xopc v2.0)
 *   - Optional ffmpeg post-processing (downstream channels handle compression)
 *   - openclaw's tempWorkspace abstraction (we use os.tmpdir() directly)
 *
 * DECISION:
 *   - Self-registers with the SpeechProviderRegistry on module load (matches
 *     the `src/voice/tts/providers/*-speech.ts` pattern). The xopc extension
 *     loader needs to import this module exactly once; subsequent imports are
 *     no-ops because module init only runs once.
 *   - Command template uses `{{Text}}`, `{{OutputPath}}`, `{{OutputDir}}`,
 *     `{{OutputBase}}` placeholders (case-insensitive). Quoted args are
 *     respected so `--prompt "hello world"` parses as one arg.
 *   - We auto-detect the produced audio file by scanning OutputDir for known
 *     audio extensions (.wav/.mp3/.opus/.ogg/.m4a). The CLI doesn't have to
 *     honor {{OutputPath}} exactly — sherpa-onnx for instance writes
 *     `<base>.wav` regardless.
 *   - synthesizeStream is intentionally omitted; CLI binaries don't stream.
 *     The orchestrator's wrapBufferAsStream fallback in speak-core handles it.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLogger } from '../../src/utils/logger.js';
import { registerSpeechProvider } from '../../src/voice/tts/speech-registry.js';
import type {
  SpeechDirectiveTokenParseContext,
  SpeechDirectiveTokenParseResult,
  SpeechProviderConfig,
  SpeechProviderConfiguredContext,
  SpeechProviderPlugin,
  SpeechProviderResolveConfigContext,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from '../../src/voice/tts/speech-provider-types.js';

const log = createLogger('SpeechProvider:LocalCLI');

const VALID_OUTPUT_FORMATS = ['mp3', 'opus', 'wav'] as const;
type OutputFormat = (typeof VALID_OUTPUT_FORMATS)[number];

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.opus', '.ogg', '.m4a']);
const DEFAULT_TIMEOUT_MS = 120_000;

interface CliConfig extends Record<string, unknown> {
  command: string;
  args?: string[];
  outputFormat: OutputFormat;
  timeoutMs: number;
  cwd?: string;
  env?: Record<string, string>;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOutputFormat(value: unknown): OutputFormat {
  const trimmed = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (VALID_OUTPUT_FORMATS.includes(trimmed as OutputFormat)) {
    return trimmed as OutputFormat;
  }
  return 'wav';
}

function normalizeConfig(rawConfig: Record<string, unknown>): CliConfig {
  const raw = asObject(rawConfig['tts-local-cli']) ?? asObject(rawConfig.cli) ?? rawConfig;
  return {
    command: trimToUndefined(raw.command) ?? '',
    ...(asStringArray(raw.args) ? { args: asStringArray(raw.args) } : {}),
    outputFormat: normalizeOutputFormat(raw.outputFormat),
    timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : DEFAULT_TIMEOUT_MS,
    ...(trimToUndefined(raw.cwd) ? { cwd: trimToUndefined(raw.cwd) } : {}),
    ...(asStringRecord(raw.env) ? { env: asStringRecord(raw.env) } : {}),
  };
}

function readProviderConfig(config: SpeechProviderConfig): CliConfig {
  return {
    command: trimToUndefined(config.command) ?? '',
    ...(asStringArray(config.args) ? { args: asStringArray(config.args) } : {}),
    outputFormat: normalizeOutputFormat(config.outputFormat),
    timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
    ...(trimToUndefined(config.cwd) ? { cwd: trimToUndefined(config.cwd) } : {}),
    ...(asStringRecord(config.env) ? { env: asStringRecord(config.env) } : {}),
  };
}

function stripEmojis(text: string): string {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyTemplate(str: string, ctx: Record<string, string | undefined>): string {
  return str.replace(/{{\s*(\w+)\s*}}/giu, (_match, key: string) => {
    const cap = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
    return ctx[cap] ?? ctx[key] ?? '';
  });
}

/** Minimal shell-style splitter — supports single + double quotes, no escapes. */
function parseCommand(cmdStr: string): { cmd: string; initialArgs: string[] } {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (const char of cmdStr.trim()) {
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    parts.push(current);
  }
  return { cmd: parts[0] ?? '', initialArgs: parts.slice(1) };
}

function findAudioFile(dir: string, baseName: string): string | null {
  const files = readdirSync(dir);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext) && (file.startsWith(baseName) || file.includes(baseName))) {
      return path.join(dir, file);
    }
  }
  // Fallback: any audio file in the dir (CLI may rename our base).
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) {
      return path.join(dir, file);
    }
  }
  return null;
}

function detectFormat(filePath: string): OutputFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.opus' || ext === '.ogg') return 'opus';
  if (ext === '.wav') return 'wav';
  if (ext === '.mp3' || ext === '.m4a') return 'mp3';
  return null;
}

function getFileExt(format: OutputFormat): string {
  if (format === 'opus') return '.opus';
  if (format === 'wav') return '.wav';
  return '.mp3';
}

interface SpawnResult {
  buffer: Buffer;
  actualFormat: OutputFormat;
  audioPath: string;
}

async function runCli(params: {
  config: CliConfig;
  text: string;
}): Promise<SpawnResult> {
  const cleanText = stripEmojis(params.text);
  if (!cleanText) {
    throw new Error('Local CLI TTS: text is empty after removing emojis');
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'xopc-tts-cli-'));
  const filePrefix = `speech-${Date.now()}`;
  const expectedExt = getFileExt(params.config.outputFormat);

  const ctx: Record<string, string | undefined> = {
    Text: cleanText,
    OutputPath: path.join(tempDir, `${filePrefix}${expectedExt}`),
    OutputDir: tempDir,
    OutputBase: filePrefix,
  };

  const { cmd, initialArgs } = parseCommand(params.config.command);
  if (!cmd) {
    throw new Error('Local CLI TTS: invalid command (empty after parse)');
  }
  const finalCmd = applyTemplate(cmd, ctx);
  const finalInitialArgs = initialArgs.map((arg) => applyTemplate(arg, ctx));
  const finalExtraArgs = (params.config.args ?? []).map((arg) => applyTemplate(arg, ctx));
  const allArgs = [...finalInitialArgs, ...finalExtraArgs];

  log.debug(
    { cmd: finalCmd, args: allArgs, tempDir, textLength: cleanText.length },
    'Spawning local TTS CLI',
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(finalCmd, allArgs, {
      ...(params.config.cwd ? { cwd: params.config.cwd } : {}),
      env: { ...process.env, ...(params.config.env ?? {}) },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Local CLI TTS: timed out after ${params.config.timeoutMs}ms`));
    }, params.config.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Local CLI TTS: command exited with code ${code}${stderr ? ` (${stderr.slice(0, 220)})` : ''}`,
          ),
        );
      }
    });
  });

  const audioPath = findAudioFile(tempDir, filePrefix);
  if (!audioPath) {
    throw new Error(`Local CLI TTS: no audio file produced in ${tempDir}`);
  }
  const buffer = readFileSync(audioPath);
  const actualFormat = detectFormat(audioPath) ?? params.config.outputFormat;

  // Best-effort cleanup. We log but never throw on cleanup failure.
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch (cleanupErr) {
    log.warn({ err: cleanupErr, tempDir }, 'Failed to cleanup local CLI temp dir');
  }

  return { buffer, actualFormat, audioPath };
}

function parseDirectiveTokenInternal(
  ctx: SpeechDirectiveTokenParseContext,
): SpeechDirectiveTokenParseResult {
  // Local CLI provider has no per-call overrides — voice/model are baked into
  // the configured command. Returning `handled: false` lets the orchestrator
  // try the next provider's parser, which avoids unexpected silent drops.
  void ctx;
  return { handled: false };
}

export const localCliSpeechProvider: SpeechProviderPlugin = {
  id: 'tts-local-cli',
  aliases: ['cli', 'local-cli'],

  resolveConfig: (ctx: SpeechProviderResolveConfigContext) => normalizeConfig(ctx.rawConfig),

  isConfigured: (ctx: SpeechProviderConfiguredContext) =>
    Boolean(readProviderConfig(ctx.providerConfig).command),

  parseDirectiveToken: parseDirectiveTokenInternal,

  // No discoverable voice catalog — the binary is opaque from our side.
  listVoices: async () => [],

  synthesize: async (req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> => {
    const config = readProviderConfig(req.providerConfig);
    if (!config.command) {
      throw new Error(
        'Local CLI TTS: command not configured (set messages.tts.providers["tts-local-cli"].command)',
      );
    }
    const { buffer, actualFormat } = await runCli({ config, text: req.text });
    return {
      audioBuffer: buffer,
      outputFormat: actualFormat,
      fileExtension: actualFormat,
      voiceCompatible: actualFormat === 'opus',
    };
  },

  // synthesizeStream intentionally omitted — CLI binaries don't stream; the
  // orchestrator falls back to wrapBufferAsStream automatically.
};

registerSpeechProvider(localCliSpeechProvider);

// Default export for convenient `import localCli from 'extensions/tts-local-cli'`
// (currently nothing imports it this way; kept for symmetry with other extensions).
export default localCliSpeechProvider;
