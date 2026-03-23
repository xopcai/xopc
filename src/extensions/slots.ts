/**
 * Extension Slot System
 * 
 * Slot exclusivity for capabilities that allow only one active implementation.
 * Some capabilities (memory backend, TTS provider) can only have one active implementation.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('Extension:Slots');

// ============================================================================
// Slot Types
// ============================================================================

export type SlotKey = 'memory' | 'tts' | 'imageGeneration' | 'webSearch';

export interface SlotClaim {
  pluginId: string;
  instance: unknown;
  claimedAt: Date;
}

export interface SlotConfig {
  /** Slot key */
  key: SlotKey;
  /** Preferred plugin ID (from config) */
  preferredPlugin?: string;
}

// ============================================================================
// Slot Registry
// ============================================================================

/**
 * Manages exclusive slots for extensions.
 * Ensures only one plugin can claim a specific slot at a time.
 */
export class SlotRegistry {
  private slots = new Map<SlotKey, SlotClaim>();

  /**
   * Claim a slot for a plugin
   * @returns true if claim succeeded, false if slot already taken
   */
  claim(key: SlotKey, pluginId: string, instance: unknown): boolean {
    const existing = this.slots.get(key);
    
    if (existing && existing.pluginId !== pluginId) {
      log.warn(
        `Slot "${key}" already claimed by "${existing.pluginId}", rejecting claim from "${pluginId}"`
      );
      return false;
    }

    this.slots.set(key, {
      pluginId,
      instance,
      claimedAt: new Date(),
    });
    
    log.info(`Slot "${key}" claimed by "${pluginId}"`);
    return true;
  }

  /**
   * Release a slot
   * @returns true if released, false if not owned by the plugin
   */
  release(key: SlotKey, pluginId: string): boolean {
    const existing = this.slots.get(key);
    
    if (!existing || existing.pluginId !== pluginId) {
      return false;
    }

    this.slots.delete(key);
    log.info(`Slot "${key}" released by "${pluginId}"`);
    return true;
  }

  /**
   * Get the instance in a slot
   */
  get<T>(key: SlotKey): T | undefined {
    return this.slots.get(key)?.instance as T | undefined;
  }

  /**
   * Check if a slot is claimed
   */
  isClaimed(key: SlotKey): boolean {
    return this.slots.has(key);
  }

  /**
   * Get which plugin claimed a slot
   */
  getClaimant(key: SlotKey): string | undefined {
    return this.slots.get(key)?.pluginId;
  }

  /**
   * Get all claimed slots
   */
  getAllClaims(): Map<SlotKey, SlotClaim> {
    return new Map(this.slots);
  }

  /**
   * Clear all slots (useful for testing or reset)
   */
  clear(): void {
    this.slots.clear();
    log.info('All slots cleared');
  }

  /**
   * Force release a slot (admin operation)
   */
  forceRelease(key: SlotKey): boolean {
    if (this.slots.has(key)) {
      const claimant = this.slots.get(key)!.pluginId;
      this.slots.delete(key);
      log.warn(`Slot "${key}" force-released (was claimed by "${claimant}")`);
      return true;
    }
    return false;
  }
}

// ============================================================================
// Slot Factory (for creating slots dynamically)
// ============================================================================

const registeredSlotTypes = new Set<SlotKey>();

/**
 * Register a new slot type (for extensibility)
 */
export function registerSlotType(key: SlotKey): void {
  if (!registeredSlotTypes.has(key)) {
    registeredSlotTypes.add(key);
    log.debug(`Registered slot type: ${key}`);
  }
}

/**
 * Get all registered slot types
 */
export function getRegisteredSlotTypes(): SlotKey[] {
  return Array.from(registeredSlotTypes);
}

// Initialize default slot types
registerSlotType('memory');
registerSlotType('tts');
registerSlotType('imageGeneration');
registerSlotType('webSearch');

// ============================================================================
// Singleton Instance
// ============================================================================

let globalSlotRegistry: SlotRegistry | null = null;

export function getSlotRegistry(): SlotRegistry {
  if (!globalSlotRegistry) {
    globalSlotRegistry = new SlotRegistry();
  }
  return globalSlotRegistry;
}

export function setSlotRegistry(registry: SlotRegistry): void {
  globalSlotRegistry = registry;
}
