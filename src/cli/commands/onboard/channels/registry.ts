/**
 * Build the list of channel configurators for onboarding: explicit entries first,
 * then declarative {@link ChannelSetupWizard} from bundled plugins (no duplicate ids).
 */

import type { ChannelPlugin } from '../../../../channels/plugin-types.js';
import { bundledChannelPlugins } from '../../../../channels/plugins/bundled.js';
import { telegramConfigurator } from './telegram.js';
import type { ChannelConfigurator } from './types.js';
import { channelSetupWizardToConfigurator } from './wizard-to-configurator.js';

/** Hand-written configurators take precedence over the same channel’s `setupWizard`. */
const OVERRIDDEN_CHANNEL_IDS = new Set(['telegram']);

function sortByMetaOrder(plugins: ChannelPlugin[]): ChannelPlugin[] {
  return [...plugins].sort((a, b) => {
    const oa = a.meta.order ?? 999;
    const ob = b.meta.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });
}

export function getChannelConfigurators(): ChannelConfigurator[] {
  const out: ChannelConfigurator[] = [telegramConfigurator];
  const seen = new Set(OVERRIDDEN_CHANNEL_IDS);
  for (const plugin of sortByMetaOrder(bundledChannelPlugins)) {
    const w = plugin.setupWizard;
    if (!w || seen.has(w.channel)) {
      continue;
    }
    seen.add(w.channel);
    out.push(
      channelSetupWizardToConfigurator(w, {
        name: plugin.meta.label,
        description: plugin.meta.blurb,
      })
    );
  }
  return out;
}
