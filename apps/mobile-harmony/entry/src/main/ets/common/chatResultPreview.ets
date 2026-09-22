import { XopcArtifact, XopcProductDelivery } from '../model/chat';

export const CHAT_RESULT_PREVIEW_COUNT = 3;

export function previewArtifacts(artifacts: XopcArtifact[], expanded: boolean): XopcArtifact[] {
  return expanded ? artifacts : artifacts.slice(0, CHAT_RESULT_PREVIEW_COUNT);
}

export function previewDeliveries(artifacts: XopcArtifact[], deliveries: XopcProductDelivery[], expanded: boolean): XopcProductDelivery[] {
  if (expanded) return deliveries;
  return deliveries.slice(0, Math.max(0, CHAT_RESULT_PREVIEW_COUNT - artifacts.length));
}

export function hiddenResultCount(artifacts: XopcArtifact[], deliveries: XopcProductDelivery[]): number {
  return Math.max(0, artifacts.length + deliveries.length - CHAT_RESULT_PREVIEW_COUNT);
}
