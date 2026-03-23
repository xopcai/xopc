/**
 * Channel Configuration Types
 * 
 * Shared types for multi-channel onboarding configuration.
 */

import type { Config } from '../../../../config/schema.js';

// DM policy type
export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';

// Group policy type
export type GroupPolicy = 'open' | 'disabled' | 'allowlist';

/**
 * Channel configurator interface.
 * Each channel plugin implements this interface.
 */
export interface ChannelConfigurator {
  /** Stable channel id */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Short description */
  description: string;
  
  /**
   * Whether this channel has the minimum credentials configured.
   * @param config Current config snapshot
   * @returns True if basic credentials are present
   */
  isConfigured(config: Config): boolean;
  
  /**
   * Run the interactive configuration flow.
   * @param config Current config snapshot
   * @returns Updated config
   */
  configure(config: Config): Promise<Config>;
}

/**
 * Channel status for onboarding UI.
 */
export interface ChannelStatus {
  id: string;
  name: string;
  description: string;
  configured: boolean;
}
