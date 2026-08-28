export type GlobalErrorSource = 'window.error' | 'unhandledrejection';

function isExpectedCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorFromWindowEvent(event: ErrorEvent): unknown {
  if (event.error !== undefined && event.error !== null) return event.error;
  const location = event.filename
    ? ` (${event.filename}${event.lineno ? `:${event.lineno}:${event.colno}` : ''})`
    : '';
  return new Error(`${event.message || 'Unknown window error'}${location}`);
}

/** Captures errors that React boundaries cannot see, such as event-handler failures and rejected promises. */
export function installGlobalErrorRecovery(
  onFatalError: (error: unknown, source: GlobalErrorSource) => void,
): () => void {
  let handled = false;

  const handleWindowError = (event: ErrorEvent) => {
    // Resource load failures also emit `error`, but are not fatal renderer exceptions.
    if (handled || (!event.message && event.error == null)) return;
    const error = errorFromWindowEvent(event);
    if (isExpectedCancellation(error)) return;
    handled = true;
    event.preventDefault();
    onFatalError(error, 'window.error');
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (handled || isExpectedCancellation(event.reason)) return;
    handled = true;
    event.preventDefault();
    onFatalError(event.reason ?? new Error('Unhandled promise rejection'), 'unhandledrejection');
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  return () => {
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
}
