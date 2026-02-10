import type { RequestContext } from '../protocol.js';

export async function handleHealth(): Promise<Record<string, unknown>> {
  return {
    status: 'ok',
    service: 'xopcbot-gateway',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

export async function handleStatus(): Promise<Record<string, unknown>> {
  return {
    status: 'ok',
    version: '0.1.0',
  };
}
