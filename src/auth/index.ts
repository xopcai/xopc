/**
 * Auth Module
 * 
 * Authentication storage and management.
 * 
 * Features:
 * - AuthStorage: Simple credential storage
 * - Auth Profiles: Advanced profile management with OAuth, round-robin, cooldown
 */

export { AuthStorage, type AuthEntry, type AuthStorageOptions } from './storage.js';
export * from './oauth/index.js';

// Auth Profiles (new architecture based on openclaw)
export * from './profiles/index.js';
