/**
 * Extension System - Loader Types
 *
 * Extension loading, manifest, and registry types.
 */

import type { ExtensionModule } from './core.js';
import type { ExtensionManifest } from './manifest.js';

export type { ExtensionManifest } from './manifest.js';

// ============================================================================
// Extension Discovery & Loading
// ============================================================================

export interface ExtensionRecord {
  id: string;
  name: string;
  version?: string;
  path: string;
  module?: ExtensionModule;
  config?: Record<string, unknown>;
  enabled: boolean;
  source: 'workspace' | 'global' | 'bundled' | 'config';
}

export interface DiscoveredExtension {
  id: string;
  path: string;
  source: 'workspace' | 'global' | 'bundled' | 'config';
  manifest: ExtensionManifest;
}

export interface ResolvedExtensionConfig {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  source: 'workspace' | 'global' | 'bundled' | 'config';
}

export interface ExtensionLoaderConfig {
  extensions: ResolvedExtensionConfig[];
}
