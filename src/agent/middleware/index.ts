/**
 * Agent Middleware - Harness engineering improvements
 *
 * Middleware modules for improving agent behavior:
 * - SelfVerifyMiddleware: Build & self-verify pattern
 */

export {
  SelfVerifyMiddleware,
  selfVerifyMiddleware,
  type FileEditRecord,
  type SelfVerifyConfig,
} from './self-verify.js';
