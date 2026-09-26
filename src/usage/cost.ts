import type { AiPricingSnapshot, AiUsageCostSource, AiUsageModel } from './types.js';

function isLocalBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')
      || host.startsWith('10.') || host.startsWith('192.168.')
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  } catch {
    return false;
  }
}

export function pricingSnapshot(model: AiUsageModel): AiPricingSnapshot {
  return {
    input: model.cost?.input ?? 0,
    output: model.cost?.output ?? 0,
    cacheRead: model.cost?.cacheRead ?? 0,
    cacheWrite: model.cost?.cacheWrite ?? 0,
  };
}

export function classifyCostSource(model: AiUsageModel): AiUsageCostSource {
  if (isLocalBaseUrl(model.baseUrl)) return 'local';
  const prices = Object.values(pricingSnapshot(model));
  return prices.some(price => price > 0) ? 'model_catalog' : 'unknown';
}

export function dollarsToMicrousd(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 1_000_000);
}
