import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';

export function dispatchGatewayRealtimeEvent(eventName: string, detail: unknown): void {
  if (eventName === 'config.reload') {
    dispatchConfigReload(detail);
    return;
  }
  window.dispatchEvent(new CustomEvent(eventName.replace(/[._]/g, '-'), { detail }));
}
