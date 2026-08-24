import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectService } from '../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  decideProactiveDisposition,
  isInQuietHours,
  nextQuietHoursEnd,
  ProjectMonitoringService,
} from '../project-monitoring-service.js';

describe('ProjectMonitoringService', () => {
  let stateDir: string;
  let service: ProjectMonitoringService;
  let projectId: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-project-monitoring-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    service = new ProjectMonitoringService();
    projectId = new ProjectService().create({ name: 'Launch' }).id;
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists a policy and synchronizes project scenario subscriptions', () => {
    const policy = service.configure({
      projectId,
      mode: 'ask_before_action',
      confidenceThreshold: 0.8,
      scenarios: ['blocked_work'],
    });

    expect(policy).toMatchObject({
      projectId,
      mode: 'ask_before_action',
      confidenceThreshold: 0.8,
      scenarios: ['blocked_work'],
      configured: true,
    });
    expect(service.get(projectId)).toEqual(policy);
  });

  it('only auto-executes an explicitly allowed low-risk action', () => {
    const policy = {
      ...service.get(projectId),
      mode: 'auto_low_risk' as const,
      allowedActions: ['send_reminder'],
      confidenceThreshold: 0.75,
    };

    expect(decideProactiveDisposition(policy, {
      confidence: 0.9, valueScore: 0.8, risk: 'low', actionId: 'send_reminder',
    })).toBe('auto_execute');
    expect(decideProactiveDisposition(policy, {
      confidence: 0.9, valueScore: 0.8, risk: 'high', actionId: 'send_reminder',
    })).toBe('request_approval');
    expect(decideProactiveDisposition(policy, {
      confidence: 0.5, valueScore: 0.8, risk: 'low', actionId: 'send_reminder',
    })).toBe('record_silently');
  });

  it('rejects unsupported action grants and evaluates overnight quiet hours', () => {
    expect(() => service.configure({ projectId, mode: 'auto_low_risk', allowedActions: ['send_reminder'] }))
      .toThrow('Unknown proactive action');
    const quietHours = { startHour: 22, endHour: 8, timezone: 'UTC' };
    const now = new Date('2026-08-13T23:30:00.000Z');
    expect(isInQuietHours(quietHours, now)).toBe(true);
    expect(nextQuietHoursEnd(quietHours, now)?.toISOString()).toBe('2026-08-14T08:00:00.000Z');
  });
});
