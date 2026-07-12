import { useEffect, useRef } from 'react';

import { isElectron } from '@/lib/electron-env';
import { TOAST_EVENT } from '@/lib/toast';
import type { DesktopPetEvent } from '@/types/electron';

type AgentStreamDetail = {
  sessionKey?: string;
  event?: unknown;
};

type ToastDetail = {
  type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message?: string;
};

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function eventPayload(record: Record<string, unknown>): Record<string, unknown> {
  return record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : {};
}

function readEventString(
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  return readString(payload, key) ?? readString(record, key);
}

function mapAgentStreamEvent(detail: AgentStreamDetail): DesktopPetEvent | null {
  const event = detail.event;
  if (!event || typeof event !== 'object') return null;
  const rec = event as Record<string, unknown>;
  const type = readString(rec, 'type');
  if (!type) return null;
  const payload = eventPayload(rec);
  const route = detail.sessionKey ? `/chat/${detail.sessionKey}` : '/chat';

  if (type === 'run_start' || type === 'assistant_message_start') {
    return { kind: 'agent-start', sessionKey: detail.sessionKey, route };
  }
  if (type === 'tool_start') {
    const toolName = readEventString(rec, payload, 'toolName') ?? readEventString(rec, payload, 'name');
    return {
      kind: 'agent-tool',
      toolName,
      sessionKey: detail.sessionKey,
      route,
    };
  }
  if (type === 'progress' || type === 'compaction') {
    return {
      kind: 'agent-progress',
      message: readEventString(rec, payload, 'message'),
      sessionKey: detail.sessionKey,
      route,
    };
  }
  if (type === 'run_end' || type === 'assistant_message_end') {
    return {
      kind: 'agent-success',
      severity: 'success',
      sessionKey: detail.sessionKey,
      route,
    };
  }
  if (type === 'error') {
    return {
      kind: 'agent-error',
      severity: 'error',
      message:
        readEventString(rec, payload, 'content') ??
        readEventString(rec, payload, 'message') ??
        readEventString(rec, payload, 'error'),
      sessionKey: detail.sessionKey,
      route,
    };
  }
  return null;
}

export function DesktopPetEventBridge() {
  const lastEventRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!isElectron() || !window.electronAPI?.pet) return;
    const send = (event: DesktopPetEvent) => {
      const key = `${event.kind}:${event.sessionKey ?? ''}:${event.message ?? ''}:${event.toolName ?? ''}`;
      const now = Date.now();
      const last = lastEventRef.current;
      if (last && last.key === key && now - last.at < 1600) return;
      lastEventRef.current = { key, at: now };
      void window.electronAPI?.pet?.sendEvent(event).catch(() => {});
    };
    const onAgentStream = (e: Event) => {
      const event = mapAgentStreamEvent((e as CustomEvent<AgentStreamDetail>).detail);
      if (event) send(event);
    };
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail?.title && !detail?.message) return;
      send({
        kind: 'toast',
        severity: detail.type,
        title: detail.title,
        message: detail.message ?? detail.title,
        route: '/chat',
      });
    };
    window.addEventListener('agent-stream-event', onAgentStream);
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener('agent-stream-event', onAgentStream);
      window.removeEventListener(TOAST_EVENT, onToast);
    };
  }, []);

  return null;
}
