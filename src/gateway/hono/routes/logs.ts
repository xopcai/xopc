import type { Hono } from 'hono';

import type { LogLevel } from '../../../utils/logger.js';
import {
  queryLogs,
  getLogFiles,
  getLogLevels,
  getFileLogStats,
  getLogModules,
  getLogErrorSummary,
  LOG_DIR,
} from '../../../utils/logger/log-store.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';

const log = createGatewayRouteLogger('Logs');
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerLogsRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {

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
      requestId: query.requestId,
      sessionId: query.sessionId,
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

  // GET /api/logs/stats - Get log statistics (file sample + runtime counters)
  authenticated.get('/api/logs/stats', async (c) => {
    const { getRuntimeLogStats } = await import('../../../utils/logger.js');
    const [fileStats, runtimeStats] = await Promise.all([
      getFileLogStats(),
      Promise.resolve(getRuntimeLogStats()),
    ]);
    return c.json({
      byLevel: fileStats.byLevel,
      runtime: {
        byLevel: runtimeStats.byLevel,
        byModule: runtimeStats.byModule,
        errorsLast24h: runtimeStats.errorsLast24h,
        uptimeMs: runtimeStats.uptimeMs,
      },
    });
  });

  // GET /api/logs/errors/summary - Aggregate recent errors by type/phase/module
  authenticated.get('/api/logs/errors/summary', async (c) => {
    const query = c.req.query();
    const items = await getLogErrorSummary({
      from: query.from,
      to: query.to,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
    });
    return c.json({ items });
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
    const { getLogDir, getRuntimeLogStats, isLoggerShuttingDown } = await import('../../../utils/logger.js');
    const { getLogFiles } = await import('../../../utils/logger/log-store.js');
    
    const stats = getRuntimeLogStats();
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
    const { setLogLevel, getLogLevel } = await import('../../../utils/logger.js');
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
    setLogLevel(level as LogLevel);
    
    // Optional: auto-revert after duration
    let autoRevertAt: string | null = null;
    if (duration) {
      const durationMs = parseInt(duration, 10) * 60000; // minutes to ms
      if (!isNaN(durationMs) && durationMs > 0) {
        autoRevertAt = new Date(Date.now() + durationMs).toISOString();
        setTimeout(() => {
          setLogLevel(previousLevel);
          log.info({ phase: 'gateway.logs.level', previousLevel, reverted: true }, `Log level auto-reverted to ${previousLevel}`);
        }, durationMs);
      }
    }
    
    log.info({ phase: 'gateway.logs.level', previousLevel, current: level, autoRevertAt }, `Log level changed to ${level}`);
    
    return c.json({
      previous: previousLevel,
      current: level,
      autoRevertAt,
      message: `Log level changed from ${previousLevel} to ${level}`,
    });
  });

  // GET /api/logs/level - Get current log level
  authenticated.get('/api/logs/level', async (c) => {
    const { getLogLevel } = await import('../../../utils/logger.js');
    return c.json({ level: getLogLevel() });
  });

  // ========== Real-time Log Streaming (SSE) ==========

  // GET /api/logs/stream - Stream logs in real-time via SSE
  authenticated.get('/api/logs/stream', async (c) => {
    const { createLogSSEHandler } = await import('../../../utils/logger/log-stream.js');
    return createLogSSEHandler()(c);
  });
}
