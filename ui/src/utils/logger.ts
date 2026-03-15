// Simple logger utility
// In production, this could be replaced with a more sophisticated logging solution

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string | { error: unknown }, ...args: unknown[]) => void;
}

const noop = (): void => {};

export function createLogger(namespace: string): Logger {
  // In development, log to console
  if (typeof window !== 'undefined' && (window as unknown as { __DEBUG__: boolean }).__DEBUG__) {
    return {
      debug: (message: string, ...args: unknown[]) => console.debug(`[${namespace}] ${message}`, ...args),
      info: (message: string, ...args: unknown[]) => console.info(`[${namespace}] ${message}`, ...args),
      warn: (message: string, ...args: unknown[]) => console.warn(`[${namespace}] ${message}`, ...args),
      error: (message: string | { error: unknown }, ...args: unknown[]) => {
        if (typeof message === 'object' && message.error) {
          console.error(`[${namespace}]`, message.error, ...args);
        } else {
          console.error(`[${namespace}] ${message}`, ...args);
        }
      },
    };
  }

  // In production, disable debug logs
  return {
    debug: noop,
    info: (message: string, ...args: unknown[]) => console.info(`[${namespace}] ${message}`, ...args),
    warn: (message: string, ...args: unknown[]) => console.warn(`[${namespace}] ${message}`, ...args),
    error: (message: string | { error: unknown }, ...args: unknown[]) => {
      if (typeof message === 'object' && message.error) {
        console.error(`[${namespace}]`, message.error, ...args);
      } else {
        console.error(`[${namespace}] ${message}`, ...args);
      }
    },
  };
}

// Default logger instance
export const logger = createLogger('app');
