/**
 * Agent Middleware - Harness engineering improvements
 *
 * Middleware modules for improving agent behavior:
 * - SelfVerifyMiddleware: Build & self-verify pattern
 * - ContextMiddleware: Automatic request context injection
 */

export {
  SelfVerifyMiddleware,
  selfVerifyMiddleware,
  type FileEditRecord,
  type SelfVerifyConfig,
} from './self-verify.js';

export {
  ContextMiddleware,
  contextMiddleware,
  withContext,
  withContextAndLogger,
  type RequestContext,
} from './context.js';
