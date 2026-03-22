/**
 * Channel setup wizard (optional UI/onboarding surface).
 */

import type { Config } from '../config/index.js';

export type { ChannelSetupWizard } from './plugins/types.adapters.js';

export interface SetupWizardEngine {
  run?(cfg: Config, channel: string, accountId?: string): Promise<void>;
}
