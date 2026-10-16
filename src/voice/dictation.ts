import type { Config } from '../config/schema.js';
import { resolveStreamingStt } from './realtime/runtime.js';
import { resolveSTTProviderChain, mergeSttConfigFromAppConfig } from './stt/index.js';

/** Select before capture; a failed request must never switch billing services. */
export function resolveDictationRoute(config: Config) {
  const recorded = mergeSttConfigFromAppConfig(config.tools?.media?.audio, config.tools?.media);
  const primary = resolveSTTProviderChain(recorded)[0];
  const streaming = config.voice?.realtime?.enabled ? resolveStreamingStt(config) : undefined;
  if (config.voice?.realtime?.enabled && config.voice.realtime.stt && !streaming) {
    return { mode: 'unavailable' as const };
  }
  if (streaming && (config.voice?.realtime?.stt || streaming.route.provider === primary?.id)) {
    return { mode: 'streaming' as const, provider: streaming.route.provider };
  }
  if (primary) return { mode: 'recorded' as const, provider: primary.id };
  return { mode: 'unavailable' as const };
}
