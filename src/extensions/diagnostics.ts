/**
 * Extension Diagnostics System
 * 
 *  Extension lifecycle enhancement with diagnostics.
 * Provides caching, diagnostics, and performance tracking.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('Extension:Diagnostics');

// ============================================================================
// Diagnostic Types
// ============================================================================

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface ExtensionDiagnostic {
  level: DiagnosticLevel;
  extensionId?: string;
  source?: string;
  message: string;
  timestamp: number;
  code?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Registry Cache
// ============================================================================

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ExtensionLoaderCache {
  /** Cache key builder */
  buildKey(options: unknown, enabledIds?: string[]): string;
  /** Get cached value */
  get<T>(key: string): T | undefined;
  /** Set cached value with TTL (in ms) */
  set<T>(key: string, value: T, ttl?: number): void;
  /** Invalidate cache */
  invalidate(key?: string): void;
  /** Check if cache exists */
  has(key: string): boolean;
}

const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Simple in-memory cache with TTL support
 */
export class ExtensionLoaderCacheImpl implements ExtensionLoaderCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  /**
   * Build a cache key from loader options
   */
  buildKey(options: {
    workspaceDir?: string;
    globalDir?: string;
    bundledDir?: string;
  }, enabledIds?: string[]): string {
    return JSON.stringify({
      workspaceDir: options.workspaceDir,
      globalDir: options.globalDir,
      bundledDir: options.bundledDir,
      enabledIds: enabledIds?.sort(),
    });
  }

  /**
   * Get cached value
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Set cached value with TTL
   */
  set<T>(key: string, value: T, ttl = DEFAULT_CACHE_TTL): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Invalidate cache
   */
  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
    log.info(key ? `Cache invalidated for: ${key}` : 'All cache invalidated');
  }

  /**
   * Check if cache exists and is valid
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// ============================================================================
// Diagnostic System
// ============================================================================

/**
 * Extension diagnostics collector
 */
export class ExtensionDiagnostics {
  private diagnostics: ExtensionDiagnostic[] = [];
  private maxDiagnostics = 1000;

  /**
   * Add a diagnostic
   */
  addDiagnostic(diagnostic: ExtensionDiagnostic): void {
    // Trim old diagnostics if needed
    if (this.diagnostics.length >= this.maxDiagnostics) {
      this.diagnostics = this.diagnostics.slice(-this.maxDiagnostics / 2);
    }

    this.diagnostics.push({
      ...diagnostic,
      timestamp: diagnostic.timestamp || Date.now(),
    });

    // Log based on level - with safety check
    const logFnName = diagnostic.level === 'error' ? 'error' : diagnostic.level === 'warn' ? 'warn' : 'info';
    const logFn = log[logFnName]?.bind(log) || (() => {});
    logFn({
      extensionId: diagnostic.extensionId,
      code: diagnostic.code,
    }, diagnostic.message);
  }

  /**
   * Add info diagnostic
   */
  info(extensionId: string, message: string, details?: Record<string, unknown>): void {
    this.addDiagnostic({ level: 'info', extensionId, message, details, timestamp: Date.now() });
  }

  /**
   * Add warning diagnostic
   */
  warn(extensionId: string, message: string, details?: Record<string, unknown>): void {
    this.addDiagnostic({ level: 'warn', extensionId, message, details, timestamp: Date.now() });
  }

  /**
   * Add error diagnostic
   */
  error(extensionId: string, message: string, details?: Record<string, unknown>): void {
    this.addDiagnostic({ level: 'error', extensionId, message, details, timestamp: Date.now() });
  }

  /**
   * Get all diagnostics
   */
  getAll(): ExtensionDiagnostic[] {
    return [...this.diagnostics];
  }

  /**
   * Get diagnostics for a specific extension
   */
  getForExtension(extensionId: string): ExtensionDiagnostic[] {
    return this.diagnostics.filter(d => d.extensionId === extensionId);
  }

  /**
   * Get diagnostics by level
   */
  getByLevel(level: DiagnosticLevel): ExtensionDiagnostic[] {
    return this.diagnostics.filter(d => d.level === level);
  }

  /**
   * Get errors
   */
  getErrors(): ExtensionDiagnostic[] {
    return this.getByLevel('error');
  }

  /**
   * Get warnings
   */
  getWarnings(): ExtensionDiagnostic[] {
    return this.getByLevel('warn');
  }

  /**
   * Clear diagnostics
   */
  clear(): void {
    this.diagnostics = [];
  }

  /**
   * Get summary
   */
  getSummary(): { errorCount: number; warnCount: number; infoCount: number } {
    return {
      errorCount: this.getByLevel('error').length,
      warnCount: this.getByLevel('warn').length,
      infoCount: this.getByLevel('info').length,
    };
  }
}

// ============================================================================
// Singleton Instances
// ============================================================================

let globalCache: ExtensionLoaderCacheImpl | null = null;
let globalDiagnostics: ExtensionDiagnostics | null = null;

export function getExtensionCache(): ExtensionLoaderCacheImpl {
  if (!globalCache) {
    globalCache = new ExtensionLoaderCacheImpl();
  }
  return globalCache;
}

export function getExtensionDiagnostics(): ExtensionDiagnostics {
  if (!globalDiagnostics) {
    globalDiagnostics = new ExtensionDiagnostics();
  }
  return globalDiagnostics;
}

export function setExtensionCache(cache: ExtensionLoaderCacheImpl): void {
  globalCache = cache;
}

export function setExtensionDiagnostics(diagnostics: ExtensionDiagnostics): void {
  globalDiagnostics = diagnostics;
}
