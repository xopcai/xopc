import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { logger } from './middleware/logger.js';
import { auth } from './middleware/auth.js';
import { createAgentSSEHandler, createAgentResumeHandler, createSendHandler, createEventsSSEHandler } from './sse.js';
import type { GatewayService } from '../service.js';
import type { Config } from '../../config/schema.js';
import { BindingsConfigSchema } from '../../config/schema.js';
import { getWorkspacePath } from '../../config/schema.js';
import { resolveHeartbeatMdPath } from '../workspace-heartbeat-path.js';
import {
  isPathUnderWorkspace,
  resolveWorkspaceSafePath,
  toWorkspaceRelativePosix,
} from '../workspace-editor-path.js';
import { runRipgrepInDirectory } from '../workspace-ripgrep.js';
import { resolveSafeInboundFilePath } from '../../channels/attachments/inbound-persist.js';
import { resolveSafeTtsFilePath } from '../../channels/attachments/outbound-tts-persist.js';
import { getVoiceModelsConfig } from '../../config/voice.js';
import { createLogger } from '../../utils/logger.js';
import { queryLogs, getLogFiles, getLogLevels, getLogStats, getLogModules, LOG_DIR } from '../../utils/logger/log-store.js';
import type { LogLevel } from '../../utils/logger.js';
import { 
  getAllModels, 
  getAvailableModels, 
  getAllProviders, 
  isProviderConfigured,
  PROVIDER_META,
  getModelRegistry,
  type Model,
  type Api,
} from '../../providers/index.js';
import { createOAuthHandler, loadOAuthCredentialsToCache } from './oauth.js';
import { createOAuthAsyncHandler } from './oauth-async.js';
import { testApiKeyResolution } from '../../config/resolve-config-value.js';
import { buildSessionKey, parseSessionKey } from '../../routing/session-key.js';
import { agentExists, getDefaultAgentId } from '../../routing/resolve-route.js';
import {
  listAgentEntries,
  normalizeAgentId,
  resolveAgentHomeDir,
  resolveDefaultAgentId,
} from '../../agent/agent-scope.js';
import { maxWebchatAgentRequestBodyBytes } from '../chat-limits.js';
import { 
  getModelsJsonPath,
  loadModelsJson,
  saveModelsJson,
  validateModelsConfig,
} from '../../config/models-json.js';
import { CredentialResolver } from '../../auth/credentials.js';
import { commandRegistry } from '../../chat-commands/index.js';
import { applyToolsWebPatch, safeToolsWebForGet } from '../config-tools-web.js';
import { createFixedWindowRateLimiter } from '../../infra/rate-limit.js';
import {
  finalizeCreateAgentDirs,
  listAgentBootstrapFiles,
  listGatewayAgents,
  prepareCreateAgent,
  prepareDeleteAgent,
  prepareUpdateAgent,
  readAgentBootstrapFile,
  runAfterDeletePurge,
  writeAgentBootstrapFile,
} from '../agents-admin.js';

const log = createLogger('HonoApp');

/** Normalize agent model ref (string | `{ primary }`) for API clients. */
function agentModelRefToString(ref: unknown): string | undefined {
  if (ref === undefined || ref === null) return undefined;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && ref !== null && 'primary' in ref) {
    const p = (ref as { primary?: string }).primary;
    return typeof p === 'string' ? p : undefined;
  }
  return undefined;
}

function agentModelFallbacksToArray(ref: unknown): string[] {
  if (typeof ref !== 'object' || ref === null || !('fallbacks' in ref)) {
    return [];
  }
  const f = (ref as { fallbacks?: unknown }).fallbacks;
  if (!Array.isArray(f)) {
    return [];
  }
  return f.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/**
 * Accept string or `{ primary, fallbacks? }` from PATCH body; coerce to schema-friendly shape.
 */
function normalizePatchAgentModel(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (typeof v === 'string') {
    return v;
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
    const fallbacks = Array.isArray(o.fallbacks)
      ? o.fallbacks.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    if (primary && fallbacks.length > 0) {
      return { primary, fallbacks };
    }
    if (primary) {
      return primary;
    }
  }
  return v;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Web UI build output: `pnpm run build:web` → `dist/gateway/static/root` (see web/vite.config.ts).
 * This file compiles to `dist/src/gateway/hono/`, so we must go up to `dist/` then into `gateway/static/root`.
 * Dev (`tsx` from `src/gateway/hono/`): use `dist/gateway/static/root` under the repo root.
 */
function resolveUiStaticRoot(): string {
  const env = process.env['XOPCBOT_UI_STATIC_ROOT']?.trim();
  if (env) return resolve(env);

  const here = __dirname;
  const normalized = here.replace(/\\/g, '/');
  if (normalized.includes('/dist/src/gateway/')) {
    return resolve(here, '../../../gateway/static/root');
  }
  // esbuild Electron bundle: `out/server/index.js` → __dirname is `.../out/server` (two levels up to app root)
  if (normalized.includes('/out/server')) {
    return resolve(here, '../../dist/gateway/static/root');
  }
  return resolve(here, '../../../dist/gateway/static/root');
}

const UI_STATIC_ROOT = resolveUiStaticRoot();

// MIME type mapping for static assets
const MIME_TYPES: Record<string, string> = {
  js: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
};

// Serve a static file from UI static root
function serveStaticFile(relativePath: string): Response | null {
  const filePath = `${UI_STATIC_ROOT}/${relativePath}`;
  try {
    const content = readFileSync(filePath);
    const ext = relativePath.split('.').pop() || '';
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return null;
  }
}

export interface HonoAppConfig {
  service: GatewayService;
  token?: string; 
}

export function createHonoApp(config: HonoAppConfig): Hono {
  const { service, token } = config;
  const app = new Hono();

  // CORS configuration
  // Compute safe default origins based on gateway bind address and port
  const gatewayPort = service.currentConfig.gateway.port ?? 18790;
  const configuredOrigins = service.currentConfig.gateway.corsOrigins;

  let corsOrigin: string | string[];
  if (configuredOrigins && configuredOrigins.length > 0) {
    // User explicitly configured origins — respect them
    corsOrigin = configuredOrigins;
  } else {
    // No explicit config: allow only loopback origins (safe default)
    corsOrigin = [
      `http://localhost:${gatewayPort}`,
      `http://127.0.0.1:${gatewayPort}`,
      // Vite dev server default port
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
  }

  const CORS_OPTIONS = {
    origin: corsOrigin,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Session-Id', 'Last-Event-ID'],
    credentials: true,
    maxAge: 86400,
  };

  // Global middleware
  app.use(logger());
  app.use(cors(CORS_OPTIONS));

  // Security headers middleware (FIX-1)
  app.use(createMiddleware(async (c, next) => {
    await next();
    // Prevent clickjacking
    c.header('X-Frame-Options', 'DENY');
    // Prevent MIME type sniffing
    c.header('X-Content-Type-Options', 'nosniff');
    // Control referrer information leakage
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Prevent reflected XSS (legacy browsers)
    c.header('X-XSS-Protection', '1; mode=block');
    // Restrict permissions API access
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // Basic CSP: allow same-origin resources, inline styles (Tailwind), and data: URIs (icons)
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
  }));

  // Request body size limit (FIX-3)
  // Larger limit for skill ZIP uploads (10MB) - must be before /api/*
  app.use('/api/skills/upload', bodyLimit({
    maxSize: 10 * 1024 * 1024,
    onError: (c) => {
      return c.json({ error: 'Skill package too large', maxSize: '10MB' }, 413);
    },
  }));

  // Default body limit for most API routes (1MB, prevents OOM DoS).
  // Web chat sends base64 attachments on POST /api/agent — use a higher cap (see `chat-limits.ts`).
  const DEFAULT_API_BODY_MAX = 1 * 1024 * 1024;
  const WEBCHAT_AGENT_BODY_MAX = maxWebchatAgentRequestBodyBytes();

  app.use('/api/*', async (c, next) => {
    const maxSize = c.req.path === '/api/agent' ? WEBCHAT_AGENT_BODY_MAX : DEFAULT_API_BODY_MAX;
    const maxSizeMb = Math.ceil(maxSize / (1024 * 1024));
    return bodyLimit({
      maxSize,
      onError: (ctx) =>
        ctx.json({ error: 'Request body too large', maxSize: `${maxSizeMb}MB` }, 413),
    })(c, next);
  });

  // Health endpoint (no auth required)
  app.get('/health', (c) => {
    return c.json(service.getHealth());
  });

  // API info (no auth required for basic info)
  app.get('/api', (c) => {
    return c.json({
      service: 'xopcbot-gateway',
      version: '0.1.0',
      transport: 'streamable-http',
      endpoints: [
        'GET  /health',
        'GET  /status',
        'POST /api/agent           (SSE stream / JSON)',
        'POST /api/agent/abort',
        'POST /api/agent/steer',
        'POST /api/send',
        'GET  /api/events          (SSE stream)',
        'GET  /api/channels/status',
        'POST /api/channels/weixin/login/start',
        'GET  /api/channels/weixin/login/:sessionKey',
        'GET  /api/config',
        'GET  /api/agents',
        'POST /api/agents',
        'PATCH /api/agents/:id',
        'DELETE /api/agents/:id',
        'GET/PUT /api/agents/:id/files/...',
        'PATCH /api/config',
        'POST /api/config/reload',
        'POST /api/heartbeat/trigger',
        '...  /api/cron/*',
        'GET/PATCH /api/sessions/:key/agent-config',
        '...  /api/sessions/*',
      ],
    });
  });

  // UI static files (no auth required)
  // Must be before authenticated routes
  app.get('/assets/*', (c) => {
    const path = c.req.path.replace('/assets/', '');
    const response = serveStaticFile(`assets/${path}`);
    if (response) return response;
    return c.text('Not found', 404);
  });

  // Favicon (no auth required)
  app.get('/favicon.ico', (c) => {
    const response = serveStaticFile('favicon.ico');
    if (response) return response;
    return c.text('Not found', 404);
  });

  // Root path - serve UI (no auth required for the page itself)
  app.get('/', (c) => {
    const response = serveStaticFile('index.html');
    if (response) return response;
    return c.text('UI not found', 404);
  });

  // Authenticated routes
  const authenticated = new Hono();
  authenticated.use(
    auth({
      token,
      getGatewayAuth: () => service.currentConfig.gateway?.auth,
    }),
  );

  // Rate limiting for high-cost API endpoints (P1-1)
  // Strict limit for LLM calls and config changes; GET queries are unrestricted
  const strictRateLimiter = new Map<string, ReturnType<typeof createFixedWindowRateLimiter>>();

  // Cleanup old limiters every 5 minutes to prevent memory leak
  const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60 * 1000;
  setInterval(() => {
    for (const [ip, limiter] of strictRateLimiter.entries()) {
      const result = limiter.consume();
      if (result.remaining === 9) { // Fresh window means idle (max=10)
        strictRateLimiter.delete(ip);
      }
    }
  }, RATE_LIMIT_CLEANUP_INTERVAL);

  // Helper middleware for strict rate limiting (10 req/min for expensive operations)
  // NOTE: Currently disabled for local development. Re-enable with proper IP detection for production.
  const strictRateLimitMiddleware = createMiddleware(async (c, next) => {
    /*
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';

    let limiter = strictRateLimiter.get(clientIp);
    if (!limiter) {
      limiter = createFixedWindowRateLimiter({ maxRequests: 10, windowMs: 60_000 });
      strictRateLimiter.set(clientIp, limiter);
    }

    const result = limiter.consume();
    if (!result.allowed) {
      c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json({ error: 'Too many requests' }, 429);
    }

    c.header('X-RateLimit-Remaining', String(result.remaining));
    */
    await next();
  });

  // Protected status endpoint
  authenticated.get('/status', (c) => {
    const health = service.getHealth();
    return c.json({
      status: health.status,
      version: health.version,
      channels: health.channels,
      uptime: health.uptime,
    });
  });

  /** Serve a persisted inbound upload from agent home `inbound/` (Web UI preview after reload). */
  authenticated.get('/api/workspace/inbound-file', async (c) => {
    const rel = c.req.query('rel');
    if (!rel || typeof rel !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing rel' } }, 400);
    }
    const cfg = service.currentConfig;
    const agentHome = resolveAgentHomeDir(cfg, resolveDefaultAgentId(cfg));
    const abs = resolveSafeInboundFilePath({ agentHome }, rel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Forbidden' } }, 403);
    }
    try {
      const buf = await readFile(abs);
      const ext = rel.split('.').pop()?.toLowerCase() ?? '';
      const mimeByExt: Record<string, string> = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        md: 'text/markdown',
        txt: 'text/plain',
        json: 'application/json',
        html: 'text/html',
        css: 'text/css',
        js: 'text/javascript',
        ts: 'text/typescript',
        webm: 'audio/webm',
        ogg: 'audio/ogg',
        opus: 'audio/ogg',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
      };
      const contentType = mimeByExt[ext] || 'application/octet-stream';
      return new Response(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
  });

  /** Serve generated TTS audio from agent home `tts/` (webchat assistant voice). */
  authenticated.get('/api/workspace/tts-file', async (c) => {
    const rel = c.req.query('rel');
    if (!rel || typeof rel !== 'string') {
      return c.json({ ok: false, error: { message: 'Missing rel' } }, 400);
    }
    const cfg = service.currentConfig;
    const agentHome = resolveAgentHomeDir(cfg, resolveDefaultAgentId(cfg));
    const abs = resolveSafeTtsFilePath({ agentHome }, rel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Forbidden' } }, 403);
    }
    try {
      const buf = await readFile(abs);
      const ext = rel.split('.').pop()?.toLowerCase() ?? '';
      const mimeByExt: Record<string, string> = {
        ogg: 'audio/ogg',
        opus: 'audio/ogg',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
      };
      const contentType = mimeByExt[ext] || 'application/octet-stream';
      return new Response(buf, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
  });

  /** Read workspace `HEARTBEAT.md` (empty string if missing). */
  authenticated.get('/api/workspace/heartbeat-md', async (c) => {
    const abs = resolveHeartbeatMdPath(service.currentConfig);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }
    try {
      const content = await readFile(abs, 'utf-8');
      return c.json({ ok: true, payload: { content: content, file: 'HEARTBEAT.md' } });
    } catch {
      return c.json({ ok: true, payload: { content: '', file: 'HEARTBEAT.md' } });
    }
  });

  /** Write workspace `HEARTBEAT.md`. */
  authenticated.put('/api/workspace/heartbeat-md', async (c) => {
    const abs = resolveHeartbeatMdPath(service.currentConfig);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const content = typeof body === 'object' && body !== null && 'content' in body && typeof (body as { content: unknown }).content === 'string'
      ? (body as { content: string }).content
      : '';
    try {
      await writeFile(abs, content, 'utf-8');
      return c.json({ ok: true, payload: { file: 'HEARTBEAT.md' } });
    } catch (err) {
      log.error({ err, path: abs }, 'Failed to write HEARTBEAT.md');
      return c.json({ ok: false, error: { message: 'Write failed' } }, 500);
    }
  });

  const EDITOR_FILE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.ts', '.js']);

  /** List directory under workspace (dir = relative path, default ""). */
  authenticated.get('/api/workspace/editor/list', async (c) => {
    const workspaceRoot = getWorkspacePath(service.currentConfig);
    if (!workspaceRoot) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }
    const dirRel = typeof c.req.query('dir') === 'string' ? c.req.query('dir')! : '';
    const absDir = resolveWorkspaceSafePath(workspaceRoot, dirRel);
    if (!absDir) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(absDir);
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
    if (!st.isDirectory()) {
      return c.json({ ok: false, error: { message: 'Not a directory' } }, 400);
    }
    const dirents = await readdir(absDir, { withFileTypes: true });
    const entries: { name: string; path: string; isDirectory: boolean }[] = [];
    for (const entry of dirents) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(absDir, entry.name);
      if (entry.isDirectory()) {
        entries.push({
          name: entry.name,
          path: toWorkspaceRelativePosix(workspaceRoot, fullPath),
          isDirectory: true,
        });
      } else if (EDITOR_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        entries.push({
          name: entry.name,
          path: toWorkspaceRelativePosix(workspaceRoot, fullPath),
          isDirectory: false,
        });
      }
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return c.json({ ok: true, payload: { entries } });
  });

  authenticated.get('/api/workspace/editor/read', async (c) => {
    const pathRel = typeof c.req.query('path') === 'string' ? c.req.query('path')! : '';
    if (!pathRel.trim()) {
      return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    }
    const workspaceRoot = getWorkspacePath(service.currentConfig);
    if (!workspaceRoot) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }
    const abs = resolveWorkspaceSafePath(workspaceRoot, pathRel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(abs);
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
    if (!st.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    try {
      const content = await readFile(abs, 'utf-8');
      return c.json({
        ok: true,
        payload: { content, path: toWorkspaceRelativePosix(workspaceRoot, abs) },
      });
    } catch {
      return c.json({ ok: false, error: { message: 'Read failed' } }, 500);
    }
  });

  authenticated.put('/api/workspace/editor/write', async (c) => {
    const workspaceRoot = getWorkspacePath(service.currentConfig);
    if (!workspaceRoot) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const pathRel =
      typeof body === 'object' &&
      body !== null &&
      'path' in body &&
      typeof (body as { path: unknown }).path === 'string'
        ? (body as { path: string }).path
        : '';
    const content =
      typeof body === 'object' &&
      body !== null &&
      'content' in body &&
      typeof (body as { content: unknown }).content === 'string'
        ? (body as { content: string }).content
        : '';
    if (!pathRel.trim()) {
      return c.json({ ok: false, error: { message: 'Missing path' } }, 400);
    }
    const abs = resolveWorkspaceSafePath(workspaceRoot, pathRel);
    if (!abs) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>> | undefined;
    try {
      st = await stat(abs);
    } catch {
      st = undefined;
    }
    if (st && !st.isFile()) {
      return c.json({ ok: false, error: { message: 'Not a file' } }, 400);
    }
    try {
      await writeFile(abs, content, 'utf-8');
      return c.json({ ok: true, payload: { path: toWorkspaceRelativePosix(workspaceRoot, abs) } });
    } catch (err) {
      log.error({ err, path: abs }, 'workspace editor write failed');
      return c.json({ ok: false, error: { message: 'Write failed' } }, 500);
    }
  });

  authenticated.get('/api/workspace/editor/search', async (c) => {
    const q = typeof c.req.query('q') === 'string' ? c.req.query('q')!.trim() : '';
    const dirRel = typeof c.req.query('dir') === 'string' ? c.req.query('dir')! : '';
    if (!q) {
      return c.json({ ok: true, payload: { results: [] as { filePath: string; lineNumber: number; lineContent: string; matchStart: number; matchEnd: number }[] } });
    }
    const workspaceRoot = getWorkspacePath(service.currentConfig);
    if (!workspaceRoot) {
      return c.json({ ok: false, error: { message: 'Workspace not configured' } }, 400);
    }
    const absDir = resolveWorkspaceSafePath(workspaceRoot, dirRel);
    if (!absDir) {
      return c.json({ ok: false, error: { message: 'Invalid path' } }, 400);
    }
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(absDir);
    } catch {
      return c.json({ ok: false, error: { message: 'Not found' } }, 404);
    }
    if (!st.isDirectory()) {
      return c.json({ ok: false, error: { message: 'Not a directory' } }, 400);
    }
    const raw = await runRipgrepInDirectory(q, absDir);
    const results = raw
      .filter((r) => isPathUnderWorkspace(workspaceRoot, r.filePath))
      .map((r) => ({
        ...r,
        filePath: toWorkspaceRelativePosix(workspaceRoot, resolve(r.filePath)),
      }));
    return c.json({ ok: true, payload: { results } });
  });

  // ========== Core SSE API ==========

  const sseConfig = { 
    service,
    maxSseConnections: service.currentConfig.gateway.maxSseConnections,
  };

  // POST /api/agent — Agent message (SSE stream or JSON fallback)
  // Apply strict rate limit: 10 req/min (prevents LLM API abuse)
  authenticated.post('/api/agent', strictRateLimitMiddleware, createAgentSSEHandler(sseConfig));

  // POST /api/agent/resume — Resume an in-progress agent run
  authenticated.post('/api/agent/resume', strictRateLimitMiddleware, createAgentResumeHandler(sseConfig));

  // POST /api/agent/abort — Abort an in-flight webchat run (by runId from SSE status)
  authenticated.post('/api/agent/abort', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    const runId =
      body && typeof body === 'object' && typeof (body as { runId?: unknown }).runId === 'string'
        ? (body as { runId: string }).runId.trim()
        : '';
    if (!runId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing runId' } },
        400,
      );
    }
    const aborted = service.abortAgentRun(runId);
    return c.json({ ok: true, payload: { aborted } });
  });

  // POST /api/agent/steer — Queue steering text for an in-flight webchat run (pi-agent `steer()`)
  authenticated.post('/api/agent/steer', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        400,
      );
    }
    const chatId =
      typeof (body as { chatId?: unknown }).chatId === 'string'
        ? (body as { chatId: string }).chatId.trim()
        : '';
    const message =
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : '';
    if (!chatId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing chatId' } },
        400,
      );
    }
    const result = service.steerWebchatAgent(chatId, message);
    if (result.ok === false) {
      const code = result.code;
      const status = code === 'BAD_REQUEST' ? 400 : code === 'NO_ACTIVE_RUN' ? 409 : 500;
      const msg =
        code === 'NO_ACTIVE_RUN'
          ? 'No active agent run for this chat'
          : code === 'STEER_FAILED'
            ? 'Steer failed'
            : 'Message required';
      return c.json({ ok: false, error: { code, message: msg } }, status);
    }
    return c.json({ ok: true, payload: { steered: true } });
  });

  // POST /api/clarify/:requestId — Answer a pending `clarify` tool (webchat)
  authenticated.post('/api/clarify/:requestId', strictRateLimitMiddleware, async (c) => {
    const requestId = c.req.param('requestId')?.trim() ?? '';
    if (!requestId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing requestId' } },
        400,
      );
    }
    const body = await c.req.json().catch(() => null);
    const answer =
      body && typeof body === 'object' && typeof (body as { answer?: unknown }).answer === 'string'
        ? (body as { answer: string }).answer.trim()
        : '';
    if (!answer) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing answer field' } },
        400,
      );
    }
    const handled = service.submitClarifyResponse(requestId, answer);
    if (!handled) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No pending clarification with this ID' } },
        404,
      );
    }
    return c.json({ ok: true, payload: { received: true } });
  });

  // POST /api/send — Send a message through a channel
  authenticated.post('/api/send', strictRateLimitMiddleware, createSendHandler(sseConfig));

  // GET /api/events — Server-pushed event stream
  authenticated.get('/api/events', createEventsSSEHandler(sseConfig));

  // GET /api/channels/status
  authenticated.get('/api/channels/status', (c) => {
    const channels = service.getChannelsStatus();
    return c.json({ ok: true, payload: { channels } });
  });

  // POST /api/channels/weixin/login/start — QR login (persists credentials on the gateway host)
  authenticated.post('/api/channels/weixin/login/start', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const account =
      body && typeof body === 'object' && typeof (body as { account?: unknown }).account === 'string'
        ? (body as { account: string }).account.trim() || undefined
        : undefined;
    const rawTimeout =
      body && typeof body === 'object' ? (body as { timeoutMs?: unknown }).timeoutMs : undefined;
    const timeoutMs =
      typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) ? Math.max(60_000, rawTimeout) : undefined;

    const { startWeixinGatewayQrLogin } = await import('../../channels/weixin/index.js');
    const result = await startWeixinGatewayQrLogin({
      configPath: service.getHealth().configPath,
      account,
      timeoutMs,
      onPersisted: async (r) => {
        if (r.ok) {
          await service.afterWeixinCredentialsPersisted();
        }
      },
    });

    if (result.ok === false) {
      return c.json(
        { ok: false, error: { code: 'WEIXIN_LOGIN_FAILED', message: result.message } },
        400,
      );
    }
    return c.json({
      ok: true,
      payload: { sessionKey: result.sessionKey, qrcodeUrl: result.qrcodeUrl },
    });
  });

  // GET /api/channels/weixin/login/:sessionKey — poll QR login state
  authenticated.get('/api/channels/weixin/login/:sessionKey', async (c) => {
    const sessionKey = c.req.param('sessionKey')?.trim() ?? '';
    if (!sessionKey) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing sessionKey' } }, 400);
    }
    const { getWeixinGatewayQrLoginStatus } = await import('../../channels/weixin/index.js');
    const status = getWeixinGatewayQrLoginStatus(sessionKey);
    return c.json({ ok: true, payload: { status } });
  });

  // POST /api/config/reload
  // Apply strict rate limit: 10 req/min (prevents config abuse)
  authenticated.post('/api/config/reload', strictRateLimitMiddleware, async (c) => {
    const result = await service.reloadConfig();
    return c.json({ ok: true, payload: result });
  });

  /** Queue an immediate heartbeat run (same coalescing path as interval/cron). */
  authenticated.post('/api/heartbeat/trigger', strictRateLimitMiddleware, async (c) => {
    let reason = 'manual';
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string') {
        const r = (body as { reason: string }).reason.trim();
        if (r) reason = r.slice(0, 120);
      }
    } catch {
      /* empty or invalid body */
    }
    service.requestHeartbeatNow({ reason });
    return c.json({ ok: true, payload: { scheduled: true } });
  });

  // GET /api/config
  authenticated.get('/api/config', async (c) => {
    const config = service.currentConfig;
    const safeConfig = {
      agents: {
        /** Default routing agent id (`agents.default` / list); safe to expose. */
        defaultId: resolveDefaultAgentId(config),
        list: listAgentEntries(config)
          .filter((e) => e.enabled !== false)
          .map((e) => ({
            id: normalizeAgentId(e.id),
            ...(typeof e.name === 'string' && e.name.trim() ? { name: e.name.trim() } : {}),
          })),
        defaults: {
          model: agentModelRefToString(config.agents?.defaults?.model) ?? '',
          modelFallbacks: agentModelFallbacksToArray(config.agents?.defaults?.model),
          imageModel: agentModelRefToString(config.agents?.defaults?.imageModel),
          imageGenerationModel: agentModelRefToString(config.agents?.defaults?.imageGenerationModel),
          mediaMaxMb: config.agents?.defaults?.mediaMaxMb,
          maxTokens: config.agents?.defaults?.maxTokens,
          temperature: config.agents?.defaults?.temperature,
          maxToolIterations: config.agents?.defaults?.maxToolIterations,
          workspace: config.agents?.defaults?.workspace,
          thinkingDefault: config.agents?.defaults?.thinkingDefault,
          reasoningDefault: config.agents?.defaults?.reasoningDefault,
          verboseDefault: config.agents?.defaults?.verboseDefault,
          compaction: config.agents?.defaults?.compaction,
          pruning: config.agents?.defaults?.pruning,
        },
      },
      channels: {
        telegram: {
          enabled: config.channels?.telegram?.enabled,
          botToken: config.channels?.telegram?.botToken || '',
          allowFrom: config.channels?.telegram?.allowFrom || [],
          groupAllowFrom: config.channels?.telegram?.groupAllowFrom || [],
          apiRoot: config.channels?.telegram?.apiRoot || '',
          debug: config.channels?.telegram?.debug || false,
          dmPolicy: config.channels?.telegram?.dmPolicy || 'pairing',
          groupPolicy: config.channels?.telegram?.groupPolicy || 'open',
          replyToMode: config.channels?.telegram?.replyToMode || 'off',
          streamMode: config.channels?.telegram?.streamMode || 'partial',
          historyLimit: config.channels?.telegram?.historyLimit || 50,
          textChunkLimit: config.channels?.telegram?.textChunkLimit || 4000,
          proxy: config.channels?.telegram?.proxy || '',
          accounts: config.channels?.telegram?.accounts || {},
        },
        weixin: {
          enabled: config.channels?.weixin?.enabled ?? false,
          dmPolicy: config.channels?.weixin?.dmPolicy || 'pairing',
          allowFrom: config.channels?.weixin?.allowFrom || [],
          debug: config.channels?.weixin?.debug ?? false,
          streamMode: config.channels?.weixin?.streamMode ?? 'partial',
          historyLimit: config.channels?.weixin?.historyLimit ?? 50,
          textChunkLimit: config.channels?.weixin?.textChunkLimit ?? 4000,
          routeTag: config.channels?.weixin?.routeTag,
          accounts: config.channels?.weixin?.accounts || {},
        },
      },
      // Provider API keys - check credential system for configured status
      providers: Object.fromEntries(
        await Promise.all(
          getAllProviders().map(async (provider) => [
            provider,
            (await isProviderConfigured(provider)) ? '***' : ''
          ])
        )
      ),
      gateway: {
        host: config.gateway?.host,
        port: config.gateway?.port,
        auth: {
          mode: config.gateway?.auth?.mode || 'token',
          token: config.gateway?.auth?.token || '',
        },
        heartbeat: {
          enabled: config.gateway?.heartbeat?.enabled,
          intervalMs: config.gateway?.heartbeat?.intervalMs,
          target: config.gateway?.heartbeat?.target,
          targetChatId: config.gateway?.heartbeat?.targetChatId,
          prompt: config.gateway?.heartbeat?.prompt,
          ackMaxChars: config.gateway?.heartbeat?.ackMaxChars,
          isolatedSession: config.gateway?.heartbeat?.isolatedSession,
          activeHours: config.gateway?.heartbeat?.activeHours,
        },
      },
      cron: { enabled: config.cron?.enabled },
      stt: config.stt,
      tts: config.tts,
      tools: safeToolsWebForGet(config),
      bindings: Array.isArray(config.bindings) ? config.bindings : [],
    };
    return c.json({ ok: true, payload: { config: safeConfig } });
  });

  // ========== Multi-agent admin REST ==========
  authenticated.get('/api/agents', async (c) => {
    const cfg = service.currentConfig as Config;
    return c.json({ ok: true, payload: listGatewayAgents(cfg) });
  });

  authenticated.post('/api/agents', strictRateLimitMiddleware, async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const name = typeof body.name === 'string' ? body.name : '';
    const workspace = typeof body.workspace === 'string' ? body.workspace : '';
    const model = typeof body.model === 'string' ? body.model : undefined;
    const agentDir = typeof body.agentDir === 'string' ? body.agentDir : undefined;
    const prep = prepareCreateAgent(service.currentConfig as Config, {
      name,
      workspace,
      model,
      agentDir,
    });
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const { nextConfig, agentId } = prep.data;
    const save = await service.saveConfig(nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    await finalizeCreateAgentDirs(service.currentConfig as Config, agentId);
    return c.json({
      ok: true,
      payload: {
        agentId,
        agents: listGatewayAgents(service.currentConfig as Config),
      },
    });
  });

  authenticated.patch('/api/agents/:id', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const skillsPatch =
      body.skills === null
        ? null
        : Array.isArray(body.skills)
          ? body.skills.map((x: unknown) => String(x).trim()).filter(Boolean)
          : undefined;
    const toolsDisablePatch =
      body.toolsDisable === null
        ? null
        : Array.isArray(body.toolsDisable)
          ? body.toolsDisable.map((x: unknown) => String(x).trim()).filter(Boolean)
          : undefined;

    const prep = prepareUpdateAgent(service.currentConfig as Config, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
      model:
        body.model === null
          ? null
          : typeof body.model === 'string'
            ? body.model
            : undefined,
      agentDir:
        body.agentDir === null
          ? null
          : typeof body.agentDir === 'string'
            ? body.agentDir
            : undefined,
      setDefault: body.setDefault === true,
      ...(skillsPatch !== undefined ? { skills: skillsPatch } : {}),
      ...(toolsDisablePatch !== undefined ? { toolsDisable: toolsDisablePatch } : {}),
    });
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const save = await service.saveConfig(prep.data.nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    return c.json({ ok: true, payload: listGatewayAgents(service.currentConfig as Config) });
  });

  authenticated.delete('/api/agents/:id', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const purge = c.req.query('purge') === '1' || c.req.query('purge') === 'true';
    const prep = prepareDeleteAgent(service.currentConfig as Config, id);
    if (prep.ok === false) {
      return c.json({ ok: false, error: { message: prep.error } }, prep.status ?? 400);
    }
    const { nextConfig, agentId } = prep.data;
    const save = await service.saveConfig(nextConfig);
    if (!save.saved) {
      return c.json({ ok: false, error: { message: save.error ?? 'save failed' } }, 500);
    }
    if (purge) {
      await runAfterDeletePurge(service.currentConfig as Config, agentId);
    }
    return c.json({
      ok: true,
      payload: { agentId, purged: purge, agents: listGatewayAgents(service.currentConfig as Config) },
    });
  });

  authenticated.get('/api/agents/:id/files', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const res = await listAgentBootstrapFiles(service.currentConfig as Config, id);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: res.data });
  });

  authenticated.get('/api/agents/:id/files/:name', async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const name = decodeURIComponent(c.req.param('name') ?? '');
    const res = await readAgentBootstrapFile(service.currentConfig as Config, id, name);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: { agentId: res.data.agentId, name, content: res.data.content } });
  });

  authenticated.put('/api/agents/:id/files/:name', strictRateLimitMiddleware, async (c) => {
    const id = normalizeAgentId(c.req.param('id') ?? '');
    const name = decodeURIComponent(c.req.param('name') ?? '');
    let content = '';
    try {
      const body = (await c.req.json()) as { content?: unknown };
      content = typeof body.content === 'string' ? body.content : '';
    } catch {
      return c.json({ ok: false, error: { message: 'Invalid JSON' } }, 400);
    }
    const res = await writeAgentBootstrapFile(service.currentConfig as Config, id, name, content);
    if (res.ok === false) {
      return c.json({ ok: false, error: { message: res.error } }, res.status ?? 400);
    }
    return c.json({ ok: true, payload: { agentId: res.data.agentId, name } });
  });

  // GET /api/voice/models - Get available STT/TTS models
  authenticated.get('/api/voice/models', (c) => {
    const models = getVoiceModelsConfig();
    return c.json({ ok: true, payload: { models } });
  });

  // PATCH /api/config - Update partial config
  // Apply strict rate limit: 10 req/min (prevents config abuse)
  authenticated.patch('/api/config', strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json();
    
    // Merge updates into current config
    const config: Config = service.currentConfig as Config;
    
    // Update agent defaults
    if (body.agents?.defaults) {
      if (!config.agents) config.agents = { defaults: { workspace: '~/.xopcbot/workspace', model: 'anthropic/claude-sonnet-4-5', maxTokens: 8192, temperature: 0.7, maxToolIterations: 20, maxRequestsPerTurn: 50, maxToolFailuresPerTurn: 3, thinkingDefault: 'medium', reasoningDefault: 'off', verboseDefault: 'off' } };
      if (!config.agents.defaults) config.agents.defaults = {} as any;
      
      if (body.agents.defaults.model !== undefined) {
        config.agents.defaults.model = normalizePatchAgentModel(body.agents.defaults.model) as Config['agents']['defaults']['model'];
      }
      if (body.agents.defaults.maxTokens !== undefined) {
        config.agents.defaults.maxTokens = body.agents.defaults.maxTokens;
      }
      if (body.agents.defaults.temperature !== undefined) {
        config.agents.defaults.temperature = body.agents.defaults.temperature;
      }
      if (body.agents.defaults.maxToolIterations !== undefined) {
        config.agents.defaults.maxToolIterations = body.agents.defaults.maxToolIterations;
      }
      if (body.agents.defaults.workspace !== undefined) {
        config.agents.defaults.workspace = body.agents.defaults.workspace;
      }
      if (body.agents.defaults.thinkingDefault !== undefined) {
        config.agents.defaults.thinkingDefault = body.agents.defaults.thinkingDefault;
      }
      if (body.agents.defaults.reasoningDefault !== undefined) {
        config.agents.defaults.reasoningDefault = body.agents.defaults.reasoningDefault;
      }
      if (body.agents.defaults.verboseDefault !== undefined) {
        config.agents.defaults.verboseDefault = body.agents.defaults.verboseDefault;
      }
      if (body.agents.defaults.imageModel !== undefined) {
        const v = body.agents.defaults.imageModel;
        if (v === '' || v === null) {
          delete (config.agents.defaults as Record<string, unknown>).imageModel;
        } else {
          config.agents.defaults.imageModel = v as string;
        }
      }
      if (body.agents.defaults.imageGenerationModel !== undefined) {
        const v = body.agents.defaults.imageGenerationModel;
        if (v === '' || v === null) {
          delete (config.agents.defaults as Record<string, unknown>).imageGenerationModel;
        } else {
          config.agents.defaults.imageGenerationModel = v as string;
        }
      }
      if (body.agents.defaults.mediaMaxMb !== undefined) {
        const v = body.agents.defaults.mediaMaxMb;
        if (v === null) {
          delete (config.agents.defaults as Record<string, unknown>).mediaMaxMb;
        } else {
          const n = typeof v === 'number' ? v : Number(v);
          if (!Number.isNaN(n) && n > 0) {
            config.agents.defaults.mediaMaxMb = n;
          }
        }
      }
    }
    
    // Update channels — use `in` / null so `weixin: null` removes the block; avoid `if (ch.weixin)` missing null.
    const patchChannels = body.channels;
    if (patchChannels != null && typeof patchChannels === 'object' && !Array.isArray(patchChannels)) {
      if ('telegram' in patchChannels) {
        const tgRaw = patchChannels.telegram;
        if (tgRaw === null) {
          if (config.channels) delete config.channels.telegram;
        } else if (typeof tgRaw === 'object' && !Array.isArray(tgRaw)) {
          const bodyTg = tgRaw as NonNullable<typeof body.channels>['telegram'];
          if (!config.channels) config.channels = { telegram: { enabled: false, botToken: '', allowFrom: [], groupAllowFrom: [], debug: false, dmPolicy: 'pairing' as const, groupPolicy: 'open' as const, replyToMode: 'off' as const, historyLimit: 50, textChunkLimit: 4000 } };
          if (!config.channels.telegram) config.channels.telegram = {} as any;

          if (bodyTg.enabled !== undefined) {
            config.channels.telegram.enabled = bodyTg.enabled;
          }
          if (bodyTg.botToken !== undefined) {
            config.channels.telegram.botToken = bodyTg.botToken;
          }
          if (bodyTg.allowFrom !== undefined) {
            config.channels.telegram.allowFrom = bodyTg.allowFrom;
          }
          if (bodyTg.apiRoot !== undefined) {
            config.channels.telegram.apiRoot = bodyTg.apiRoot;
          }
          if (bodyTg.debug !== undefined) {
            config.channels.telegram.debug = bodyTg.debug;
          }
          if (bodyTg.streamMode !== undefined) {
            config.channels.telegram.streamMode = bodyTg.streamMode;
          }
          if (bodyTg.groupAllowFrom !== undefined) {
            config.channels.telegram.groupAllowFrom = bodyTg.groupAllowFrom;
          }
          if (bodyTg.dmPolicy !== undefined) {
            config.channels.telegram.dmPolicy = bodyTg.dmPolicy;
          }
          if (bodyTg.groupPolicy !== undefined) {
            config.channels.telegram.groupPolicy = bodyTg.groupPolicy;
          }
          if (bodyTg.replyToMode !== undefined) {
            config.channels.telegram.replyToMode = bodyTg.replyToMode;
          }
          if (bodyTg.historyLimit !== undefined) {
            config.channels.telegram.historyLimit = bodyTg.historyLimit;
          }
          if (bodyTg.textChunkLimit !== undefined) {
            config.channels.telegram.textChunkLimit = bodyTg.textChunkLimit;
          }
          if (bodyTg.proxy !== undefined) {
            config.channels.telegram.proxy = bodyTg.proxy;
          }
          if (bodyTg.accounts !== undefined) {
            config.channels.telegram.accounts = bodyTg.accounts;
          }
        }
      }

      if ('weixin' in patchChannels) {
        const wxRaw = patchChannels.weixin;
        if (wxRaw === null) {
          if (config.channels) delete config.channels.weixin;
        } else if (typeof wxRaw === 'object' && !Array.isArray(wxRaw)) {
          const wx = wxRaw as NonNullable<typeof body.channels>['weixin'];
          if (!config.channels) config.channels = {} as any;
          if (!config.channels.weixin) {
            config.channels.weixin = {
              enabled: false,
              dmPolicy: 'pairing',
              allowFrom: [],
              debug: false,
              historyLimit: 50,
              textChunkLimit: 4000,
            };
          }
          if (wx.enabled !== undefined) config.channels.weixin.enabled = wx.enabled;
          if (wx.dmPolicy !== undefined) config.channels.weixin.dmPolicy = wx.dmPolicy;
          if (wx.allowFrom !== undefined) config.channels.weixin.allowFrom = wx.allowFrom;
          if (wx.debug !== undefined) config.channels.weixin.debug = wx.debug;
          if (wx.streamMode !== undefined) config.channels.weixin.streamMode = wx.streamMode;
          if (wx.historyLimit !== undefined) config.channels.weixin.historyLimit = wx.historyLimit;
          if (wx.textChunkLimit !== undefined) config.channels.weixin.textChunkLimit = wx.textChunkLimit;
          if ('routeTag' in wx) {
            if (wx.routeTag === null || wx.routeTag === undefined || wx.routeTag === '') {
              delete config.channels.weixin.routeTag;
            } else {
              config.channels.weixin.routeTag = wx.routeTag as string | number;
            }
          }
          if (wx.accounts !== undefined) config.channels.weixin.accounts = wx.accounts;
        }
      }
    }
    
    // Update gateway heartbeat (partial merge)
    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      if (!config.gateway) {
        config.gateway = {
          host: '0.0.0.0',
          port: 18790,
          heartbeat: { enabled: true, intervalMs: 1_800_000 },
          maxSseConnections: 100,
          corsOrigins: ['*'],
        };
      }
      if (!config.gateway.heartbeat) config.gateway.heartbeat = { enabled: true, intervalMs: 1_800_000 };
      const h = config.gateway.heartbeat;
      const p = body.gateway.heartbeat as Record<string, unknown>;
      if (p.enabled !== undefined) h.enabled = Boolean(p.enabled);
      if (p.intervalMs !== undefined && typeof p.intervalMs === 'number' && Number.isFinite(p.intervalMs)) {
        h.intervalMs = p.intervalMs;
      }
      if (p.target !== undefined) {
        if (p.target === null || p.target === '') delete (h as { target?: string }).target;
        else (h as { target?: string }).target = String(p.target);
      }
      if (p.targetChatId !== undefined) {
        if (p.targetChatId === null || p.targetChatId === '') delete (h as { targetChatId?: string }).targetChatId;
        else (h as { targetChatId?: string }).targetChatId = String(p.targetChatId);
      }
      if (p.prompt !== undefined) {
        if (p.prompt === null || p.prompt === '') delete (h as { prompt?: string }).prompt;
        else (h as { prompt?: string }).prompt = String(p.prompt);
      }
      if (p.ackMaxChars !== undefined) {
        if (p.ackMaxChars === null || p.ackMaxChars === '') delete (h as { ackMaxChars?: number }).ackMaxChars;
        else if (typeof p.ackMaxChars === 'number' && Number.isFinite(p.ackMaxChars)) {
          (h as { ackMaxChars?: number }).ackMaxChars = p.ackMaxChars;
        }
      }
      if (p.isolatedSession !== undefined) {
        if (p.isolatedSession === null || p.isolatedSession === false) {
          delete (h as { isolatedSession?: boolean }).isolatedSession;
        } else {
          (h as { isolatedSession?: boolean }).isolatedSession = Boolean(p.isolatedSession);
        }
      }
      if (p.activeHours !== undefined) {
        if (p.activeHours === null) {
          delete (h as { activeHours?: unknown }).activeHours;
        } else if (typeof p.activeHours === 'object' && p.activeHours !== null) {
          const ah = p.activeHours as Record<string, unknown>;
          const start = typeof ah.start === 'string' ? ah.start : '';
          const end = typeof ah.end === 'string' ? ah.end : '';
          if (start && end) {
            (h as { activeHours?: { start: string; end: string; timezone?: string } }).activeHours = {
              start,
              end,
              ...(typeof ah.timezone === 'string' && ah.timezone.trim() ? { timezone: ah.timezone } : {}),
            };
          } else {
            delete (h as { activeHours?: unknown }).activeHours;
          }
        }
      }
    }
    if (body.gateway?.auth !== undefined) {
      if (!config.gateway) config.gateway = { host: '0.0.0.0', port: 18790, heartbeat: { enabled: true, intervalMs: 1_800_000 }, maxSseConnections: 100, corsOrigins: ['*'] };
      if (!config.gateway.auth) config.gateway.auth = { mode: 'token' };
      const a = body.gateway.auth;
      if (a.mode !== undefined) {
        config.gateway.auth.mode = a.mode;
      }
      if (a.token !== undefined) {
        config.gateway.auth.token = a.token;
      }
    }

    // Update providers config - save to credential system instead of config
    if (body.providers) {
      const resolver = new CredentialResolver();
      for (const [key, apiKey] of Object.entries(body.providers)) {
        if (
          apiKey !== undefined &&
          typeof apiKey === 'string' &&
          apiKey.trim() &&
          apiKey !== '***' &&
          apiKey !== '••••••••••••'
        ) {
          await resolver.saveApiKey(key, apiKey, { profileName: 'default' });
        }
      }
    }

    // Update STT config
    if (body.stt !== undefined) {
      config.stt = body.stt;
    }

    // Update TTS config
    if (body.tts !== undefined) {
      config.tts = body.tts;
    }

    const toolsPatchErr = applyToolsWebPatch(config, body as Record<string, unknown>);
    if (toolsPatchErr) {
      return c.json({ ok: false, error: { message: toolsPatchErr } }, 400);
    }

    if (body.bindings !== undefined) {
      if (!Array.isArray(body.bindings)) {
        return c.json({ ok: false, error: { message: 'bindings must be an array' } }, 400);
      }
      const parsed = BindingsConfigSchema.safeParse(body.bindings);
      if (!parsed.success) {
        return c.json(
          { ok: false, error: { message: parsed.error.issues.map((i) => i.message).join('; ') } },
          400,
        );
      }
      config.bindings = parsed.data;
    }

    // Save config
    const result = await service.saveConfig(config);
    if (!result.saved) {
      return c.json({ ok: false, error: result.error }, 500);
    }

    if (body.gateway?.heartbeat !== undefined && typeof body.gateway.heartbeat === 'object') {
      service.reloadHeartbeatFromCurrentConfig();
    }

    return c.json({ ok: true, payload: { config } });
  });

  // ========== Auth API (/api/auth) ==========

  // GET /api/auth/token - Get current gateway token
  authenticated.get('/api/auth/token', (c) => {
    const authToken = service.getAuthToken();
    return c.json({ 
      ok: true, 
      payload: { 
        token: authToken,
        mode: service.getAuthMode(),
      } 
    });
  });

  // POST /api/auth/token/refresh - Generate new gateway token
  authenticated.post('/api/auth/token/refresh', async (c) => {
    try {
      const newToken = await service.refreshAuthToken();
      return c.json({ 
        ok: true, 
        payload: { 
          token: newToken,
          message: 'Token refreshed successfully. Please update your client configuration.'
        } 
      });
    } catch (err) {
      return c.json({ 
        ok: false, 
        error: err instanceof Error ? err.message : 'Failed to refresh token' 
      }, 500);
    }
  });

  // ========== OAuth API (/api/auth/oauth) ==========
  authenticated.route('/api/auth/oauth', createOAuthHandler(service));

  // ========== Async OAuth API (/api/auth/oauth-async) ==========
  authenticated.route('/api/auth/oauth-async', createOAuthAsyncHandler(service));

  // Load OAuth credentials from config into cache on startup
  loadOAuthCredentialsToCache(service);

  // ========== Registry API ==========
  
  // GET /api/registry - Full registry for frontend
  authenticated.get('/api/registry', async (c) => {
    const allModels = getAllModels();
    const availableModels = await getAvailableModels();
    const configured = new Set(availableModels.map(m => `${m.provider}/${m.id}`));
    
    // Group models by provider
    const providerMap = new Map<string, Model<Api>[]>();
    for (const model of allModels) {
      const list = providerMap.get(model.provider) ?? [];
      list.push(model);
      providerMap.set(model.provider, list);
    }
    
    return c.json({
      ok: true,
      payload: {
        version: 'pi-ai',
        providers: Array.from(providerMap.entries()).map(([id, models]) => ({
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1),
          configured: models.some(m => configured.has(`${m.provider}/${m.id}`)),
          models: models.map(m => ({
            ref: `${m.provider}/${m.id}`,
            id: m.id,
            name: m.name,
            provider: m.provider,
            reasoning: m.reasoning ?? false,
            input: m.input ?? ['text'],
            contextWindow: m.contextWindow ?? 128000,
            maxTokens: m.maxTokens ?? 4096,
            cost: {
              input: m.cost?.input ?? 0,
              output: m.cost?.output ?? 0,
            },
            available: configured.has(`${m.provider}/${m.id}`),
          })),
        })),
      },
    });
  });

  // POST /api/registry/reload — reload gateway config and refresh model list for clients
  authenticated.post('/api/registry/reload', async (c) => {
    try {
      // Reload config
      await service.reloadConfig();
      
      // Reload OAuth credentials from new config
      loadOAuthCredentialsToCache(service);
      
      const models = getAllModels();
      
      // Emit SSE event to all connected clients
      service.emit('registry.updated', { modelCount: models.length });
      
      return c.json({
        ok: true,
        payload: {
          message: 'Registry reloaded',
          modelCount: models.length,
        },
      });
    } catch (err) {
      return c.json({
        error: err instanceof Error ? err.message : 'Failed to reload registry',
      }, 500);
    }
  });

  // ========== Models.json API ==========

  // GET /api/models-json - Get models.json configuration
  authenticated.get('/api/models-json', async (c) => {
    const path = getModelsJsonPath();
    const { config, error } = loadModelsJson(path);
    const registry = getModelRegistry();
    
    return c.json({
      ok: true,
      payload: {
        config,
        path,
        exists: error === undefined,
        loadError: error || registry.getError(),
      },
    });
  });

  // POST /api/models-json/validate - Validate models.json configuration
  authenticated.post('/api/models-json/validate', async (c) => {
    const body = await c.req.json();
    const { config } = body;
    
    const result = validateModelsConfig(config);
    
    return c.json({
      ok: true,
      payload: result,
    });
  });

  // PATCH /api/models-json - Save models.json configuration
  authenticated.patch('/api/models-json', async (c) => {
    const body = await c.req.json();
    const { config } = body;
    
    const path = getModelsJsonPath();
    const result = saveModelsJson(path, config);
    
    if (!result.success) {
      return c.json({ ok: false, error: result.error }, 400);
    }
    
    // Refresh registry
    const registry = getModelRegistry();
    registry.refresh();
    
    // Emit event
    service.emit('models-json.updated', { 
      modelCount: registry.getAll().length,
    });
    
    return c.json({ 
      ok: true, 
      payload: { 
        saved: true,
        modelCount: registry.getAll().length,
      },
    });
  });

  // POST /api/models-json/reload - Hot reload models.json
  authenticated.post('/api/models-json/reload', async (c) => {
    const registry = getModelRegistry();
    registry.refresh();
    
    const error = registry.getError();
    const models = registry.getAll();
    
    service.emit('models-json.reloaded', { 
      modelCount: models.length,
      error: error || undefined,
    });
    
    return c.json({
      ok: true,
      payload: {
        modelCount: models.length,
        error,
      },
    });
  });

  // POST /api/models-json/test-api-key - Test API key resolution
  authenticated.post('/api/models-json/test-api-key', async (c) => {
    const body = await c.req.json();
    const { value } = body;
    
    const result = testApiKeyResolution(value);
    
    return c.json({
      ok: true,
      payload: result,
    });
  });

  // GET /api/models - Get available models (only configured providers)
  authenticated.get('/api/models', async (c) => {
    const models = (await getAvailableModels()).map(m => ({
      id: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 4096,
      reasoning: m.reasoning ?? false,
      vision: m.input?.includes('image') ?? false,
      cost: {
        input: m.cost?.input ?? 0,
        output: m.cost?.output ?? 0,
      },
    }));

    // Sort by provider then name
    models.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });

    return c.json({ ok: true, payload: { models } });
  });

  // GET /api/providers - Get ALL available providers and models
  authenticated.get('/api/providers', async (c) => {
    const allModels = getAllModels();
    const availableModels = await getAvailableModels();
    const configured = new Set(availableModels.map(m => `${m.provider}/${m.id}`));
    
    const models = allModels.map(m => ({
      id: `${m.provider}/${m.id}`,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 4096,
      reasoning: m.reasoning ?? false,
      vision: m.input?.includes('image') ?? false,
      cost: {
        input: m.cost?.input ?? 0,
        output: m.cost?.output ?? 0,
      },
      available: configured.has(`${m.provider}/${m.id}`),
    }));

    // Sort by provider then name
    models.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      return a.name.localeCompare(b.name);
    });

    return c.json({ ok: true, payload: { models } });
  });

  // GET /api/providers/meta - Get provider metadata (categories, display names)
  authenticated.get('/api/providers/meta', async (c) => {
    const providers = getAllProviders();
    
    const meta = await Promise.all(providers.map(async provider => ({
      id: provider,
      name: PROVIDER_META[provider]?.name || provider,
      category: PROVIDER_META[provider]?.category || 'specialty',
      supportsOAuth: PROVIDER_META[provider]?.supportsOAuth ?? false,
      supportsApiKey: PROVIDER_META[provider]?.supportsApiKey ?? true,
      configured: await isProviderConfigured(provider),
    })));

    return c.json({ ok: true, payload: { providers: meta } });
  });

  // ========== Chat slash commands (CommandRegistry) ==========

  authenticated.get('/api/commands', (c) => {
    const commands = commandRegistry
      .list()
      .filter((cmd) => cmd.scope.includes('global') || cmd.scope.includes('private'))
      .map((cmd) => ({
        id: cmd.id,
        name: cmd.name,
        aliases: cmd.aliases ?? [],
        description: cmd.description,
        category: cmd.category,
        acceptsArgs: cmd.acceptsArgs ?? false,
        examples: cmd.examples ?? [],
      }));
    return c.json({ ok: true, payload: { commands } });
  });

  // ========== Skills (managed global skills under ~/.xopcbot/skills) ==========

  authenticated.get('/api/skills', (c) => {
    const payload = service.getSkillsApi();
    return c.json({ ok: true, payload });
  });

  authenticated.get('/api/skills/:skillName/content', (c) => {
    const raw = c.req.param('skillName');
    if (!raw) {
      return c.json({ ok: false, error: 'Missing skill name' }, 400);
    }
    let skillName: string;
    try {
      skillName = decodeURIComponent(raw);
    } catch {
      return c.json({ ok: false, error: 'Invalid skill name' }, 400);
    }
    const data = service.getSkillMarkdownSource(skillName);
    if (!data) {
      return c.json({ ok: false, error: 'Skill not found' }, 404);
    }
    return c.json({ ok: true, payload: data });
  });

  authenticated.post('/api/skills/reload', (c) => {
    service.reloadSkillsFromDisk();
    return c.json({ ok: true });
  });

  authenticated.patch('/api/skills/enabled', async (c) => {
    let body: { skillName?: unknown; enabled?: unknown };
    try {
      body = (await c.req.json()) as { skillName?: unknown; enabled?: unknown };
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    const skillName = typeof body.skillName === 'string' ? body.skillName.trim() : '';
    const enabled = body.enabled;
    if (!skillName || typeof enabled !== 'boolean') {
      return c.json({ ok: false, error: 'Expected { skillName: string, enabled: boolean }' }, 400);
    }
    try {
      service.patchSkillEnabled(skillName, enabled);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Update failed' },
        400,
      );
    }
  });

  authenticated.post('/api/skills/upload', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody({ all: true });
    } catch {
      return c.json({ ok: false, error: 'Invalid multipart body' }, 400);
    }
    const file = body['file'];
    if (!file || typeof file !== 'object') {
      return c.json({ ok: false, error: 'Missing file field' }, 400);
    }
    let buf: Buffer;
    if (file instanceof File) {
      buf = Buffer.from(await file.arrayBuffer());
    } else if (typeof (file as Blob).arrayBuffer === 'function') {
      buf = Buffer.from(await (file as Blob).arrayBuffer());
    } else {
      return c.json({ ok: false, error: 'Invalid file upload' }, 400);
    }
    const skillIdRaw = body['skillId'];
    const overwriteRaw = body['overwrite'];
    const skillId = typeof skillIdRaw === 'string' && skillIdRaw.trim() ? skillIdRaw.trim() : undefined;
    const overwrite =
      overwriteRaw === 'true' ||
      overwriteRaw === true ||
      overwriteRaw === '1';

    try {
      const result = service.installManagedSkillZip(buf, { skillId, overwrite });
      return c.json({ ok: true, payload: result });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Install failed' },
        400,
      );
    }
  });

  authenticated.delete('/api/skills/:id', (c) => {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ ok: false, error: 'Missing id' }, 400);
    }
    try {
      service.deleteManagedSkill(id);
      return c.json({ ok: true });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : 'Delete failed' },
        400,
      );
    }
  });

  // ========== Cron REST API (/api/cron) ==========

  // GET /api/cron - List all jobs
  authenticated.get('/api/cron', async (c) => {
    const jobs = await service.cronServiceInstance.listJobs();
    return c.json({ jobs });
  });

  // POST /api/cron - Add new job
  authenticated.post('/api/cron', async (c) => {
    const body = await c.req.json();
    const { schedule, name, timezone, sessionTarget, agentId, model, delivery, payload } = body;

    if (!schedule || !payload) {
      return c.json({ error: 'Missing required fields: schedule, payload' }, 400);
    }

    try {
      const result = await service.cronServiceInstance.addJob(schedule, {
        name,
        timezone,
        sessionTarget,
        ...(typeof agentId === 'string' && agentId.trim() ? { agentId: agentId.trim() } : {}),
        model,
        delivery,
        payload,
      });
      return c.json(result, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to add job' }, 400);
    }
  });

  // GET /api/cron/metrics - Get cron metrics (must be before /:id)
  authenticated.get('/api/cron/metrics', async (c) => {
    const metrics = await service.cronServiceInstance.getMetrics();
    return c.json(metrics);
  });

  // GET /api/cron/runs/history - Recent runs across all jobs (must be before /:id)
  authenticated.get('/api/cron/runs/history', async (c) => {
    const raw = c.req.query('limit');
    const limit = raw ? parseInt(raw, 10) : 50;
    const runs = await service.cronServiceInstance.getAllRunsHistory(Number.isFinite(limit) ? limit : 50);
    return c.json({ runs });
  });

  // GET /api/cron/:id - Get single job (must be after /metrics)
  authenticated.get('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const job = await service.cronServiceInstance.getJob(id);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }
    return c.json({ job });
  });

  // POST /api/cron/:id/toggle - Toggle job enabled
  authenticated.post('/api/cron/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return c.json({ error: 'Missing required field: enabled' }, 400);
    }

    const result = await service.cronServiceInstance.toggleJob(id, enabled);
    return c.json({ toggled: result });
  });

  // POST /api/cron/:id/run - Trigger job manually
  authenticated.post('/api/cron/:id/run', async (c) => {
    const id = c.req.param('id');

    try {
      await service.cronServiceInstance.runJobNow(id);
      return c.json({ triggered: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to run job' }, 400);
    }
  });

  // GET /api/cron/:id/history - Get job execution history
  authenticated.get('/api/cron/:id/history', async (c) => {
    const id = c.req.param('id');
    const raw = c.req.query('limit');
    const limit = raw ? parseInt(raw, 10) : 10;
    const history = await service.cronServiceInstance.getJobHistory(id, Number.isFinite(limit) ? limit : 10);
    return c.json({ history });
  });

  // PATCH /api/cron/:id - Update job
  authenticated.patch('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();

    try {
      const result = await service.cronServiceInstance.updateJob(id, body);
      return c.json({ updated: result });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to update job' }, 400);
    }
  });

  // DELETE /api/cron/:id - Remove job
  authenticated.delete('/api/cron/:id', async (c) => {
    const id = c.req.param('id');
    const result = await service.cronServiceInstance.removeJob(id);
    return c.json({ removed: result });
  });

  // ========== Session REST API (/api/sessions) ==========

  // POST /api/sessions - Create new session (reuses empty sessions)
  authenticated.post('/api/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const channel = body.channel || 'webchat';
    const routingCfg = service.currentConfig;
    let agentId =
      typeof body.agentId === 'string' && body.agentId.trim()
        ? body.agentId.trim().toLowerCase()
        : getDefaultAgentId(routingCfg);
    if (!agentExists(agentId, routingCfg)) {
      agentId = getDefaultAgentId(routingCfg);
    }

    // If a specific chat_id is provided, use it (for advanced use cases)
    // Otherwise, try to find and reuse an existing empty session
    if (body.chat_id) {
      const sessionKey = buildSessionKey({
        agentId,
        source: channel,
        accountId: 'default',
        peerKind: 'direct',
        peerId: body.chat_id,
      });

      await service.sessionManagerInstance.saveMessages(sessionKey, []);
      const session = await service.getSession(sessionKey);
      return c.json({ session }, 201);
    }
    
    // Look for existing empty sessions to reuse
    const existingSessions = await service.listSessions({
      channel,
      limit: 50,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    
    // Reuse an empty session only when it matches the requested agent (session key embeds agent id).
    const emptySession = existingSessions.items.find((s) => {
      if (s.messageCount !== 0) return false;
      const parsed = parseSessionKey(s.key);
      return parsed?.agentId === agentId;
    });
    
    if (emptySession) {
      // Return existing empty session instead of creating a new one
      const session = await service.getSession(emptySession.key);
      return c.json({ session, reused: true }, 200);
    }
    
    // No empty session found, create a new one
    const chatId = `chat_${Date.now()}`;
    const sessionKey = buildSessionKey({
      agentId,
      source: channel,
      accountId: 'default',
      peerKind: 'direct',
      peerId: chatId,
    });

    await service.sessionManagerInstance.saveMessages(sessionKey, []);

    const session = await service.getSession(sessionKey);
    return c.json({ session }, 201);
  });

  // GET /api/sessions - List sessions
  authenticated.get('/api/sessions', async (c) => {
    const query = c.req.query();
    const result = await service.listSessions({
      status: query.status as any,
      search: query.search,
      channel: query.channel,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return c.json(result);
  });

  // GET /api/sessions/stats - Get session stats (must be before /:key)
  authenticated.get('/api/sessions/stats', async (c) => {
    const result = await service.getSessionStats();
    return c.json(result);
  });

  // GET /api/sessions/chat-ids - Get unique chat IDs from sessions (must be before /:key)
  authenticated.get('/api/sessions/chat-ids', async (c) => {
    const channel = c.req.query('channel');
    const chatIds = await service.getSessionChatIds(channel || undefined);
    return c.json({ ok: true, payload: { chatIds } });
  });

  // GET /api/sessions/:key/agent-config — resolved session agent settings (thinking, etc.)
  authenticated.get('/api/sessions/:key/agent-config', async (c) => {
    const key = c.req.param('key');
    const payload = await service.getSessionAgentConfig(key);
    return c.json({ ok: true, payload });
  });

  authenticated.patch('/api/sessions/:key/agent-config', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({}));
    const result = await service.patchSessionAgentConfig(key, body);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, 400);
    }
    return c.json({ ok: true });
  });

  // GET /api/sessions/:key - Get single session (must be after /stats and /chat-ids)
  authenticated.get('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ session });
  });

  // GET /api/sessions/:key/export - Export session (must be before /:key)
  authenticated.get('/api/sessions/:key/export', async (c) => {
    const key = c.req.param('key');
    const format = c.req.query('format') as any || 'json';
    const result = await service.exportSession(key, format);
    return c.json(result);
  });

  // DELETE /api/sessions/:key - Delete session
  authenticated.delete('/api/sessions/:key', async (c) => {
    const key = c.req.param('key');
    const result = await service.deleteSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/archive - Archive session
  authenticated.post('/api/sessions/:key/archive', async (c) => {
    const key = c.req.param('key');
    const result = await service.archiveSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/unarchive - Unarchive session
  authenticated.post('/api/sessions/:key/unarchive', async (c) => {
    const key = c.req.param('key');
    const result = await service.unarchiveSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/pin - Pin session
  authenticated.post('/api/sessions/:key/pin', async (c) => {
    const key = c.req.param('key');
    const result = await service.pinSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/unpin - Unpin session
  authenticated.post('/api/sessions/:key/unpin', async (c) => {
    const key = c.req.param('key');
    const result = await service.unpinSession(key);
    return c.json(result);
  });

  // POST /api/sessions/:key/rename - Rename session
  authenticated.post('/api/sessions/:key/rename', async (c) => {
    const key = c.req.param('key');

    const body = await c.req.json();
    const { name } = body;
    const result = await service.renameSession(key, name);
    return c.json(result);
  });

  // ========== Subagent REST API (/api/subagents) ==========

  // GET /api/subagents - List subagent sessions
  authenticated.get('/api/subagents', async (c) => {
    const query = c.req.query();
    const result = await service.listSubagents({
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });
    return c.json(result);
  });

  // GET /api/subagents/:key - Get subagent session detail
  authenticated.get('/api/subagents/:key', async (c) => {
    const key = c.req.param('key');
    // Verify it's a subagent session
    if (!key.startsWith('subagent:')) {
      return c.json({ error: 'Not a subagent session' }, 400);
    }
    const session = await service.getSession(key);
    if (!session) {
      return c.json({ error: 'Subagent session not found' }, 404);
    }
    return c.json({ session });
  });

  // ========== Logs REST API (/api/logs) ==========

  // GET /api/logs - Query logs with filters
  authenticated.get('/api/logs', async (c) => {
    const query = c.req.query();
    const logs = await queryLogs({
      levels: query.level ? query.level.split(',') as LogLevel[] : undefined,
      from: query.from,
      to: query.to,
      q: query.q,
      module: query.module,
      limit: query.limit ? parseInt(query.limit) : 100,
      offset: query.offset ? parseInt(query.offset) : 0,
    });
    return c.json({ logs, count: logs.length });
  });

  // GET /api/logs/files - List log files
  authenticated.get('/api/logs/files', async (c) => {
    const files = getLogFiles();
    return c.json({ files });
  });

  // GET /api/logs/stats - Get log statistics
  authenticated.get('/api/logs/stats', async (c) => {
    const stats = getLogStats();
    return c.json(stats);
  });

  // GET /api/logs/levels - Get available log levels
  authenticated.get('/api/logs/levels', async (c) => {
    return c.json({ levels: getLogLevels() });
  });

  // GET /api/logs/modules - Get available modules
  authenticated.get('/api/logs/modules', async (c) => {
    const modules = await getLogModules();
    return c.json({ modules });
  });

  // GET /api/logs/dir - Get log directory path
  authenticated.get('/api/logs/dir', async (c) => {
    return c.json({ dir: LOG_DIR });
  });

  // GET /api/logs/health - Get log system health status
  authenticated.get('/api/logs/health', async (c) => {
    const { getLogDir, getLogStats, isLoggerShuttingDown } = await import('../../utils/logger.js');
    const { getLogFiles } = await import('../../utils/logger/log-store.js');
    
    const stats = getLogStats();
    const files = getLogFiles().slice(0, 5);
    const isShuttingDown = isLoggerShuttingDown();
    
    return c.json({
      status: isShuttingDown ? 'shutting_down' : 'healthy',
      config: {
        dir: getLogDir(),
        uptimeMs: stats.uptimeMs,
      },
      stats: {
        byLevel: stats.byLevel,
        errorsLast24h: stats.errorsLast24h,
        modulesTracked: stats.byModule ? Object.keys(stats.byModule).length : 0,
      },
      files: files.map(f => ({
        name: f.name,
        size: f.size,
        modified: f.modified,
        type: f.type,
      })),
      shuttingDown: isShuttingDown,
    });
  });

  // POST /api/logs/level - Set log level dynamically
  authenticated.post('/api/logs/level', async (c) => {
    const { setLogLevel, getLogLevel } = await import('../../utils/logger.js');
    const body = await c.req.json().catch(() => ({}));
    const { level, duration } = body as { level?: string; duration?: string };
    
    if (!level) {
      return c.json({ error: 'level is required' }, 400);
    }
    
    const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    if (!validLevels.includes(level)) {
      return c.json({ error: `Invalid level. Must be one of: ${validLevels.join(', ')}` }, 400);
    }
    
    const previousLevel = getLogLevel();
    setLogLevel(level as any);
    
    // Optional: auto-revert after duration
    let autoRevertAt: string | null = null;
    if (duration) {
      const durationMs = parseInt(duration) * 60000; // minutes to ms
      if (!isNaN(durationMs) && durationMs > 0) {
        autoRevertAt = new Date(Date.now() + durationMs).toISOString();
        setTimeout(() => {
          setLogLevel(previousLevel);
          console.log(`[Logger] Auto-reverted log level to ${previousLevel}`);
        }, durationMs);
      }
    }
    
    return c.json({
      previous: previousLevel,
      current: level,
      autoRevertAt,
      message: `Log level changed from ${previousLevel} to ${level}`,
    });
  });

  // GET /api/logs/level - Get current log level
  authenticated.get('/api/logs/level', async (c) => {
    const { getLogLevel } = await import('../../utils/logger.js');
    return c.json({ level: getLogLevel() });
  });

  // ========== Real-time Log Streaming (SSE) ==========

  // GET /api/logs/stream - Stream logs in real-time via SSE
  authenticated.get('/api/logs/stream', async (c) => {
    const { createLogSSEHandler } = await import('../../utils/logger/log-stream.js');
    return createLogSSEHandler()(c);
  });

  // ========== Extension HTTP Routes ==========
  const extensionRegistry = service.getExtensionRegistry?.();
  if (extensionRegistry) {
    // Register extension HTTP routes
    const httpRoutes = extensionRegistry.httpRoutes;
    for (const [path, handler] of httpRoutes) {
      // POST handler
      authenticated.post(path, async (c) => {
        const req = {
          method: c.req.method,
          url: c.req.url,
          headers: c.req.header(),
          body: await c.req.json().catch(() => ({})),
        };
        const response = await handler(req as any);
        if (response) {
          if (response.status) c.status(response.status as any);
          if (response.headers) {
            for (const [key, value] of Object.entries(response.headers)) {
              c.header(key, value);
            }
          }
          if (response.body !== undefined) {
            return c.json(response.body);
          }
        }
        return c.text('');
      });

      // GET handler
      authenticated.get(path, async (c) => {
        const req = {
          method: c.req.method,
          url: c.req.url,
          headers: c.req.header(),
        };
        const response = await handler(req as any);
        if (response) {
          if (response.status) c.status(response.status as any);
          if (response.headers) {
            for (const [key, value] of Object.entries(response.headers)) {
              c.header(key, value);
            }
          }
          if (response.body !== undefined) {
            return c.json(response.body);
          }
        }
        return c.text('');
      });
    }
  }

  // ========== Extension Gateway Methods ==========

  // POST /api/gateway/:method - Invoke a gateway method
  authenticated.post('/api/gateway/:method', async (c) => {
    const method = c.req.param('method');
    const params = await c.req.json().catch(() => ({}));
    try {
      const result = await service.invokeGatewayMethod(method, params);
      return c.json({ ok: true, result });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, 400);
    }
  });

  // Mount authenticated routes
  app.route('/', authenticated);

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    log.error({ err }, 'Hono error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
