/**
 * Skill Configuration Manager
 * 
 * Handles skill-specific configuration and environment variables.
 * Inspired by openclaw's skills config system
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import type { SkillConfig, SkillsConfig, Skill } from './types.js';

const log = createLogger('SkillConfig');

/**
 * Resolve skill configuration from multiple sources
 * 
 * Priority (highest to lowest):
 * 1. Environment variable overrides (XOPCBOT_SKILL_<NAME>_<KEY>)
 * 2. Config file entries
 * 3. Skill defaults
 */
export function resolveSkillConfig(
  skill: Skill,
  skillsConfig?: SkillsConfig
): SkillConfig {
  const config: SkillConfig = {};

  // Start with config file entries
  const entryConfig = skillsConfig?.entries?.[skill.name];
  if (entryConfig) {
    config.enabled = entryConfig.enabled;
    config.apiKey = entryConfig.apiKey;
    config.env = entryConfig.env ? { ...entryConfig.env } : undefined;
    config.config = entryConfig.config ? { ...entryConfig.config } : undefined;
  }

  // Apply environment variable overrides
  const envPrefix = `XOPCBOT_SKILL_${skill.name.toUpperCase().replace(/-/g, '_')}`;
  
  // Check for enabled override
  const enabledEnv = process.env[`${envPrefix}_ENABLED`];
  if (enabledEnv !== undefined) {
    config.enabled = enabledEnv.toLowerCase() === 'true' || enabledEnv === '1';
  }

  // Check for API key override
  const apiKeyEnv = process.env[`${envPrefix}_API_KEY`];
  if (apiKeyEnv) {
    config.apiKey = apiKeyEnv;
  }

  // Check for environment variable overrides
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(`${envPrefix}_ENV_`)) {
      const envKey = key.slice(`${envPrefix}_ENV_`.length);
      if (!config.env) {
        config.env = {};
      }
      config.env[envKey] = value;
    }
  }

  return config;
}

/**
 * Apply environment variable overrides to a skill's environment
 */
export function applySkillEnvOverrides(
  skill: Skill,
  baseEnv: Record<string, string> = {},
  skillConfig?: SkillConfig
): Record<string, string> {
  const env: Record<string, string> = { ...baseEnv };

  // Apply config env
  if (skillConfig?.env) {
    for (const [key, value] of Object.entries(skillConfig.env)) {
      env[key] = value;
    }
  }

  // Apply environment variable overrides
  const envPrefix = `XOPCBOT_SKILL_${skill.name.toUpperCase().replace(/-/g, '_')}`;
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(`${envPrefix}_ENV_`)) {
      const envKey = key.slice(`${envPrefix}_ENV_`.length);
      env[envKey] = value;
    }
  }

  return env;
}

/**
 * Get the effective environment for a skill
 */
export function getSkillEnvironment(
  skill: Skill,
  skillsConfig?: SkillsConfig
): Record<string, string> {
  const config = resolveSkillConfig(skill, skillsConfig);
  return applySkillEnvOverrides(skill, process.env as Record<string, string>, config);
}

/**
 * Skill configuration file manager
 */
export interface SkillConfigFile {
  /** Path to the config file */
  configPath: string;
  /** Load configuration */
  load: () => SkillsConfig;
  /** Save configuration */
  save: (config: SkillsConfig) => void;
  /** Get skill-specific config */
  getSkillConfig: (skillName: string) => SkillConfig | undefined;
  /** Update skill configuration */
  updateSkillConfig: (skillName: string, config: Partial<SkillConfig>) => void;
  /** Enable/disable a skill */
  setSkillEnabled: (skillName: string, enabled: boolean) => void;
  /** Set skill API key */
  setSkillApiKey: (skillName: string, apiKey: string) => void;
}

/**
 * Create a skill configuration file manager
 */
export function createSkillConfigManager(configDir: string): SkillConfigFile {
  const configPath = join(configDir, 'skills.json');

  function loadConfig(): SkillsConfig {
    if (!existsSync(configPath)) {
      return {};
    }

    try {
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      log.warn({ error: err }, 'Failed to load skills config, using defaults');
      return {};
    }
  }

  function saveConfig(config: SkillsConfig): void {
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      log.info('Saved skills config');
    } catch (err) {
      log.error({ error: err }, 'Failed to save skills config');
    }
  }

  return {
    configPath,

    load: loadConfig,

    save: saveConfig,

    getSkillConfig: (skillName: string) => {
      const config = loadConfig();
      return config.entries?.[skillName];
    },

    updateSkillConfig: (skillName: string, updates: Partial<SkillConfig>) => {
      const config = loadConfig();
      
      if (!config.entries) {
        config.entries = {};
      }

      const existing = config.entries[skillName] || {};
      config.entries[skillName] = {
        ...existing,
        ...updates,
      };

      saveConfig(config);
    },

    setSkillEnabled: (skillName: string, enabled: boolean) => {
      const config = loadConfig();
      
      if (!config.entries) {
        config.entries = {};
      }

      const existing = config.entries[skillName] || {};
      config.entries[skillName] = {
        ...existing,
        enabled,
      };

      saveConfig(config);
      log.info({ skillName, enabled }, 'Updated skill enabled state');
    },

    setSkillApiKey: (skillName: string, apiKey: string) => {
      const config = loadConfig();
      
      if (!config.entries) {
        config.entries = {};
      }

      const existing = config.entries[skillName] || {};
      config.entries[skillName] = {
        ...existing,
        apiKey,
      };

      saveConfig(config);
      log.info({ skillName }, 'Updated skill API key');
    },
  };
}

/**
 * Check if a skill is enabled
 */
export function isSkillEnabled(
  skill: Skill,
  skillsConfig?: SkillsConfig
): boolean {
  const config = resolveSkillConfig(skill, skillsConfig);
  
  // Explicitly disabled
  if (config.enabled === false) {
    return false;
  }

  // Check if skill has requirements that are not met
  const requires = skill.metadata.requires || skill.metadata.openclaw?.requires;
  if (requires?.bins) {
    const { hasBinary } = require('./installer.js');
    for (const bin of requires.bins) {
      if (!hasBinary(bin)) {
        log.debug({ skill: skill.name, bin }, 'Skill requirement not met');
        return false;
      }
    }
  }

  return true;
}

/**
 * Validate skill configuration
 */
export function validateSkillConfig(config: SkillsConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate limits
  const limits = config.limits;
  if (limits) {
    if (limits.maxCandidatesPerRoot !== undefined && limits.maxCandidatesPerRoot < 1) {
      errors.push('limits.maxCandidatesPerRoot must be at least 1');
    }
    if (limits.maxSkillsLoadedPerSource !== undefined && limits.maxSkillsLoadedPerSource < 1) {
      errors.push('limits.maxSkillsLoadedPerSource must be at least 1');
    }
    if (limits.maxSkillsInPrompt !== undefined && limits.maxSkillsInPrompt < 1) {
      errors.push('limits.maxSkillsInPrompt must be at least 1');
    }
  }

  // Validate entries
  if (config.entries) {
    for (const [skillName, skillConfig] of Object.entries(config.entries)) {
      if (skillConfig.apiKey && typeof skillConfig.apiKey !== 'string') {
        errors.push(`entries.${skillName}.apiKey must be a string`);
      }
      if (skillConfig.env && typeof skillConfig.env !== 'object') {
        errors.push(`entries.${skillName}.env must be an object`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
