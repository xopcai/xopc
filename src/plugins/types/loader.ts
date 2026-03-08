/**
 * Plugin System - Loader Types
 * 
 * Plugin loading, manifest, and registry types.
 */

import type { PluginModule } from './core.js';

// ============================================================================
// Plugin Discovery & Loading
// ============================================================================

export interface PluginRecord {
  id: string;
  name: string;
  version?: string;
  path: string;
  module?: PluginModule;
  config?: Record<string, unknown>;
  enabled: boolean;
  source: 'workspace' | 'global' | 'bundled' | 'config';
}

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  kind?: string;
  main?: string;
  configSchema?: Record<string, unknown>;
  dependencies?: Record<string, string>;
}

export interface ResolvedPluginConfig {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  source: 'workspace' | 'global' | 'bundled' | 'config';
}

export interface PluginLoaderConfig {
  plugins: ResolvedPluginConfig[];
}
