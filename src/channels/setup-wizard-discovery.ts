import type { ChannelPlugin } from './plugin-types.js';

/** Channel ids that expose `setupWizard` (onboard / tooling). */
export function collectSetupWizardChannels(plugins: ChannelPlugin[]): string[] {
  return plugins.filter((p) => p.setupWizard).map((p) => p.setupWizard!.channel);
}
