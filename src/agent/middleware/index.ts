/**
 * Agent middleware — request-scoped log context (`ContextMiddleware`) and
 * harness-style self-verify tracking (`SelfVerifyMiddleware`).
 */

export {
  SelfVerifyMiddleware,
  type FileEditRecord,
  type SelfVerifyConfig,
} from './self-verify.js';

export { ContextMiddleware, type RequestContext } from './context.js';
