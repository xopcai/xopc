import { classifyUserError, XopcUserErrorContext, XopcUserErrorKind } from './userErrorClassifier';

export function userErrorTitle(raw: string, context: XopcUserErrorContext = 'generic'): ResourceStr {
  const kind: XopcUserErrorKind = classifyUserError(raw, context);
  switch (kind) {
    case 'offline': return $r('app.string.error_offline_title');
    case 'unavailable': return context === 'collection' ? $r('app.string.error_collection_title') : $r('app.string.error_unavailable_title');
    case 'missing': return $r('app.string.error_missing_title');
    case 'authentication': return $r('app.string.error_authentication_title');
    case 'conflict': return $r('app.string.error_conflict_title');
    case 'rate_limited': return $r('app.string.error_rate_limited_title');
    case 'permission': return $r('app.string.error_permission_title');
    case 'too_large': return $r('app.string.error_too_large_title');
    case 'invalid': return $r('app.string.error_invalid_title');
    default: return $r('app.string.error_unknown_title');
  }
}

export function userErrorMessage(raw: string, context: XopcUserErrorContext = 'generic'): ResourceStr {
  const kind: XopcUserErrorKind = classifyUserError(raw, context);
  switch (kind) {
    case 'offline': return $r('app.string.error_offline_message');
    case 'unavailable': return context === 'collection' ? $r('app.string.error_collection_message') : $r('app.string.error_unavailable_message');
    case 'missing': return $r('app.string.error_missing_message');
    case 'authentication': return $r('app.string.error_authentication_message');
    case 'conflict': return $r('app.string.error_conflict_message');
    case 'rate_limited': return $r('app.string.error_rate_limited_message');
    case 'permission': return $r('app.string.error_permission_message');
    case 'too_large': return $r('app.string.error_too_large_message');
    case 'invalid': return $r('app.string.error_invalid_message');
    default: return $r('app.string.error_unknown_message');
  }
}
