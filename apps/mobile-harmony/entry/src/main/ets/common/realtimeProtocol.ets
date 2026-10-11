import { DEVICE_TOOL_CATALOG_JSON, DEVICE_STATE_TOOL_CATALOG_JSON } from './deviceToolCatalog';
import type { XopcEndpointHello, XopcSubscription } from '../model/realtime';

export const XOPC_REALTIME_PROTOCOL_VERSION: number = 2;

// Descriptors are generated in the Gateway canonical order.
export function endpointProof(hello: XopcEndpointHello): string {
  const catalog = hello.tools.length === 0 ? '[]' : hello.tools.length === 2 ? DEVICE_STATE_TOOL_CATALOG_JSON : DEVICE_TOOL_CATALOG_JSON;
  if (JSON.stringify(hello.tools) !== catalog) throw new Error('UNSUPPORTED_ENDPOINT_TOOLS');
  return '{"appVersion":' + JSON.stringify(hello.appVersion)
    + ',"availability":' + JSON.stringify(hello.availability)
    + ',"connectionInstanceId":' + JSON.stringify(hello.connectionInstanceId)
    + ',"displayName":' + JSON.stringify(hello.displayName)
    + ',"endpointId":' + JSON.stringify(hello.endpointId)
    + ',"kind":' + JSON.stringify(hello.kind)
    + ',"nonce":' + JSON.stringify(hello.nonce)
    + ',"platform":' + JSON.stringify(hello.platform)
    + ',"principalId":' + JSON.stringify(hello.principalId)
    + ',"signedAt":' + JSON.stringify(hello.signedAt) + ',"tools":' + catalog + '}';
}

export class XopcCursors {
  private cursors: Map<string, number> = new Map<string, number>();
  add(topic: string, afterSeq: number = 0): void {
    if (!this.cursors.has(topic)) this.cursors.set(topic, afterSeq);
  }
  remove(topic: string): void { this.cursors.delete(topic); }
  clear(): void { this.cursors.clear(); }
  has(topic: string): boolean { return this.cursors.has(topic); }
  rebase(topic: string, seq: number): void {
    if (this.cursors.has(topic) && Number.isSafeInteger(seq) && seq >= 0) this.cursors.set(topic, seq);
  }
  accept(topic: string, seq: number): boolean {
    const previous = this.cursors.get(topic);
    if (previous === undefined || !Number.isSafeInteger(seq) || seq <= previous) return false;
    this.cursors.set(topic, seq);
    return true;
  }
  snapshot(): XopcSubscription[] {
    const subscriptions: XopcSubscription[] = [];
    this.cursors.forEach((seq: number, topic: string): void => {
      subscriptions.push({ topic, afterSeq: seq, view: topic.startsWith('run:') ? 'compact' : undefined });
    });
    return subscriptions;
  }
}
