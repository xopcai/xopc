/**
 * Audit Log
 * 
 * Independent audit log stream for security-sensitive events:
 * - Authentication events (login, logout, token refresh)
 * - Configuration changes
 * - Permission changes
 * - Data access events
 */

import { appendFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getLogDir } from './config.js';

// ============================================
// Types
// ============================================

export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.token_refresh'
  | 'auth.failed'
  | 'config.update'
  | 'config.reload'
  | 'permission.grant'
  | 'permission.revoke'
  | 'data.access'
  | 'data.export'
  | 'data.delete'
  | 'admin.action';

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: AuditEventType;
  actor: {
    userId?: string;
    sessionId?: string;
    ip?: string;
    userAgent?: string;
  };
  resource: {
    type: string;
    id?: string;
    path?: string;
  };
  action: {
    type: string;
    result: 'success' | 'failure' | 'denied';
    details?: Record<string, unknown>;
  };
  metadata?: {
    requestId?: string;
    location?: string;
    reason?: string;
  };
}

export interface AuditLogConfig {
  enabled: boolean;
  logDir?: string;
  retentionDays?: number;
  logToConsole?: boolean;
  sensitiveFields?: string[];
}

// ============================================
// Configuration
// ============================================

const DEFAULT_SENSITIVE_FIELDS = [
  'password', 'token', 'apiKey', 'secret', 'credential',
  'authorization', 'cookie', 'session',
];

let auditConfig: AuditLogConfig = {
  enabled: true,
  retentionDays: 90,
  logToConsole: false,
  sensitiveFields: DEFAULT_SENSITIVE_FIELDS,
};

export function configureAuditLog(config: Partial<AuditLogConfig>): void {
  auditConfig = { ...auditConfig, ...config };
}

export function getAuditConfig(): AuditLogConfig {
  return { ...auditConfig };
}

// ============================================
// Event Generation
// ============================================

let seq = 0;

function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  const sequence = (++seq).toString(36).padStart(4, '0');
  return `audit_${timestamp}_${sequence}_${random}`;
}

function redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  if (!auditConfig.sensitiveFields) return data;
  
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const isSensitive = auditConfig.sensitiveFields.some(
      field => key.toLowerCase().includes(field.toLowerCase())
    );
    redacted[key] = isSensitive ? '***REDACTED***' : value;
  }
  return redacted;
}

// TODO: Use redactSensitiveData for action.details redaction
void redactSensitiveData;

// ============================================
// Storage
// ============================================

function getAuditLogPath(date: Date = new Date()): string {
  const dateStr = date.toISOString().split('T')[0];
  const logDir = auditConfig.logDir || path.join(getLogDir(), 'audit');
  
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  
  return path.join(logDir, `audit-${dateStr}.log`);
}

async function writeAuditEvent(event: AuditEvent): Promise<void> {
  if (!auditConfig.enabled) return;

  const logLine = JSON.stringify(event) + '\n';
  const logPath = getAuditLogPath();

  try {
    await appendFile(logPath, logLine, 'utf-8');
    
    if (auditConfig.logToConsole) {
      console.log(`[AUDIT] ${event.type}: ${event.action.type} by ${event.actor.userId || 'anonymous'}`);
    }
  } catch (err) {
    console.error('[AuditLog] Failed to write audit event:', err);
  }
}

// ============================================
// Public API
// ============================================

export async function logAuditEvent(
  type: AuditEventType,
  params: {
    actor?: AuditEvent['actor'];
    resource: AuditEvent['resource'];
    action: Omit<AuditEvent['action'], 'result'> & { result?: AuditEvent['action']['result'] };
    metadata?: AuditEvent['metadata'];
  }
): Promise<AuditEvent> {
  const event: AuditEvent = {
    id: generateEventId(),
    timestamp: new Date().toISOString(),
    type,
    actor: params.actor || {},
    resource: params.resource,
    action: {
      result: 'success',
      ...params.action,
    },
    metadata: params.metadata,
  };

  await writeAuditEvent(event);
  return event;
}

// Convenience functions for common events
export async function logAuthEvent(
  type: 'auth.login' | 'auth.logout' | 'auth.token_refresh' | 'auth.failed',
  params: {
    userId?: string;
    sessionId?: string;
    ip?: string;
    userAgent?: string;
    result: 'success' | 'failure' | 'denied';
    reason?: string;
  }
): Promise<AuditEvent> {
  return logAuditEvent(type, {
    actor: {
      userId: params.userId,
      sessionId: params.sessionId,
      ip: params.ip,
      userAgent: params.userAgent,
    },
    resource: { type: 'auth' },
    action: {
      type: type.split('.')[1],
      result: params.result,
      details: params.reason ? { reason: params.reason } : undefined,
    },
  });
}

export async function logConfigChange(
  params: {
    userId?: string;
    section: string;
    path: string;
    oldValue?: unknown;
    newValue?: unknown;
    result: 'success' | 'failure';
  }
): Promise<AuditEvent> {
  return logAuditEvent('config.update', {
    actor: { userId: params.userId },
    resource: {
      type: 'config',
      id: params.section,
      path: params.path,
    },
    action: {
      type: 'update',
      result: params.result,
      details: {
        oldValue: params.oldValue ? '[REDACTED]' : undefined,
        newValue: params.newValue ? '[REDACTED]' : undefined,
      },
    },
  });
}

export async function logPermissionChange(
  params: {
    userId?: string;
    targetUserId: string;
    action: 'grant' | 'revoke';
    permission: string;
    resourceType: string;
    resourceId?: string;
    result: 'success' | 'failure';
  }
): Promise<AuditEvent> {
  return logAuditEvent(
    params.action === 'grant' ? 'permission.grant' : 'permission.revoke',
    {
      actor: { userId: params.userId },
      resource: {
        type: params.resourceType,
        id: params.resourceId,
      },
      action: {
        type: params.action,
        result: params.result,
        details: {
          targetUserId: params.targetUserId,
          permission: params.permission,
        },
      },
    }
  );
}

export async function logDataAccess(
  params: {
    userId?: string;
    sessionId?: string;
    action: 'read' | 'write' | 'delete' | 'export';
    resourceType: string;
    resourceId?: string;
    path?: string;
    result: 'success' | 'failure' | 'denied';
    metadata?: Record<string, unknown>;
  }
): Promise<AuditEvent> {
  const typeMap: Record<string, AuditEventType> = {
    read: 'data.access',
    write: 'data.access',
    delete: 'data.delete',
    export: 'data.export',
  };

  return logAuditEvent(typeMap[params.action], {
    actor: {
      userId: params.userId,
      sessionId: params.sessionId,
    },
    resource: {
      type: params.resourceType,
      id: params.resourceId,
      path: params.path,
    },
    action: {
      type: params.action,
      result: params.result,
      details: params.metadata,
    },
  });
}
