import { join } from 'path';
import { mkdir, readdir, stat, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { createLogger } from '../utils/logger.js';
import { resolveHomeDir, ENV_VARS } from './paths.js';

const log = createLogger('Profile');

// ============================================
// Types
// ============================================

export interface ProfileInfo {
  /** Profile name */
  name: string;
  /** Full path to state directory */
  stateDir: string;
  /** Whether this is the currently active profile */
  isActive: boolean;
  /** Number of agents in this profile */
  agentCount: number;
  /** Profile creation time */
  createdAt?: Date;
}

// ============================================
// Path Resolution
// ============================================

/**
 * Resolve state directory for a specific profile
 */
export function resolveProfileStateDir(profile: string): string {
  const home = resolveHomeDir();
  return profile === 'default'
    ? join(home, '.xopcbot')
    : join(home, `.xopcbot-${profile}`);
}

/**
 * Get the name of a profile from its state directory path
 */
export function getProfileNameFromDir(stateDir: string): string {
  const home = resolveHomeDir();
  const relative = stateDir.replace(home, '').replace(/^\//, '');

  if (relative === '.xopcbot') {
    return 'default';
  }

  const match = relative.match(/^\.xopcbot-(.+)$/);
  return match ? match[1] : 'default';
}

/**
 * Get the currently active profile name from environment
 */
export function getCurrentProfile(): string {
  // Check XOPCBOT_PROFILE first
  if (process.env[ENV_VARS.PROFILE]) {
    return process.env[ENV_VARS.PROFILE]!;
  }

  // Infer from XOPCBOT_STATE_DIR
  if (process.env[ENV_VARS.STATE_DIR]) {
    return getProfileNameFromDir(process.env[ENV_VARS.STATE_DIR]!);
  }

  return 'default';
}

// ============================================
// Profile Management
// ============================================

export class ProfileManager {
  private readonly homeDir: string;

  constructor() {
    this.homeDir = resolveHomeDir();
  }

  /**
   * List all available profiles
   */
  async listProfiles(): Promise<ProfileInfo[]> {
    const profiles: ProfileInfo[] = [];
    const currentProfile = getCurrentProfile();

    // Check for default profile
    const defaultDir = join(this.homeDir, '.xopcbot');
    if (existsSync(defaultDir)) {
      profiles.push(await this.getProfileInfo('default', currentProfile === 'default'));
    }

    // Check for named profiles
    try {
      const entries = await readdir(this.homeDir, { withFileTypes: true });
      const profileDirs = entries.filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith('.xopcbot-') &&
          entry.name !== '.xopcbot'
      );

      for (const dir of profileDirs) {
        const name = dir.name.replace('.xopcbot-', '');
        profiles.push(await this.getProfileInfo(name, currentProfile === name));
      }
    } catch (error) {
      log.warn({ error }, 'Failed to list profile directories');
    }

    return profiles.sort((a, b) => {
      // Default profile first, then alphabetical
      if (a.name === 'default') return -1;
      if (b.name === 'default') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Create a new profile
   */
  async createProfile(name: string): Promise<ProfileInfo> {
    if (name === 'default') {
      throw new Error('Cannot create a profile named "default", use "init" instead');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        'Profile name must contain only letters, numbers, hyphens, and underscores'
      );
    }

    const stateDir = resolveProfileStateDir(name);

    if (existsSync(stateDir)) {
      throw new Error(`Profile "${name}" already exists at ${stateDir}`);
    }

    // Create basic directory structure
    await mkdir(stateDir, { recursive: true });
    await mkdir(join(stateDir, 'agents'), { recursive: true });
    await mkdir(join(stateDir, 'credentials'), { recursive: true });
    await mkdir(join(stateDir, 'extensions'), { recursive: true });
    await mkdir(join(stateDir, 'skills'), { recursive: true });
    await mkdir(join(stateDir, 'cron'), { recursive: true });
    await mkdir(join(stateDir, 'logs'), { recursive: true });
    await mkdir(join(stateDir, 'bin'), { recursive: true });
    await mkdir(join(stateDir, 'tools'), { recursive: true });

    log.info({ name, stateDir }, 'Created new profile');

    return this.getProfileInfo(name, false);
  }

  /**
   * Delete a profile (with safety checks)
   */
  async deleteProfile(name: string, options: { force?: boolean } = {}): Promise<void> {
    if (name === 'default') {
      throw new Error('Cannot delete the default profile');
    }

    const stateDir = resolveProfileStateDir(name);

    if (!existsSync(stateDir)) {
      throw new Error(`Profile "${name}" does not exist`);
    }

    // Safety check: don't delete if it's the current profile
    const currentProfile = getCurrentProfile();
    if (currentProfile === name && !options.force) {
      throw new Error(
        `Cannot delete profile "${name}" because it is currently active. ` +
          `Switch to another profile first or use --force.`
      );
    }

    // Delete the directory
    await rm(stateDir, { recursive: true, force: true });

    log.info({ name }, 'Deleted profile');
  }

  /**
   * Get shell command to switch to a profile
   */
  getSwitchCommand(name: string): string {
    if (name === 'default') {
      return `unset ${ENV_VARS.PROFILE}`;
    }
    return `export ${ENV_VARS.PROFILE}=${name}`;
  }

  /**
   * Get the profile state directory
   */
  getProfileStateDir(name: string): string {
    return resolveProfileStateDir(name);
  }

  // ============================================
  // Private Methods
  // ============================================

  private async getProfileInfo(name: string, isActive: boolean): Promise<ProfileInfo> {
    const stateDir = resolveProfileStateDir(name);

    let agentCount = 0;
    let createdAt: Date | undefined;

    try {
      const stats = await stat(stateDir);
      createdAt = stats.birthtime;

      // Count agents
      const agentsDir = join(stateDir, 'agents');
      if (existsSync(agentsDir)) {
        const entries = await readdir(agentsDir, { withFileTypes: true });
        agentCount = entries.filter((e) => e.isDirectory()).length;
      }
    } catch (error) {
      log.warn({ name, error }, 'Failed to get profile stats');
    }

    return {
      name,
      stateDir,
      isActive,
      agentCount,
      createdAt,
    };
  }
}

// ============================================
// Convenience Functions
// ============================================

let defaultManager: ProfileManager | null = null;

export function getProfileManager(): ProfileManager {
  if (!defaultManager) {
    defaultManager = new ProfileManager();
  }
  return defaultManager;
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const manager = getProfileManager();
  return manager.listProfiles();
}

export async function createProfile(name: string): Promise<ProfileInfo> {
  const manager = getProfileManager();
  return manager.createProfile(name);
}

export async function deleteProfile(name: string, options?: { force?: boolean }): Promise<void> {
  const manager = getProfileManager();
  return manager.deleteProfile(name, options);
}

export function getSwitchCommand(name: string): string {
  const manager = getProfileManager();
  return manager.getSwitchCommand(name);
}
