/**
 * Error classification system for xopcbot
 * 
 * Provides structured error types for better handling and user feedback.
 */

export type ErrorCategory = 'user' | 'config' | 'system' | 'network' | 'provider';

// Symbol markers for reliable type identification
const XOPCBOT_ERROR_MARKER = Symbol.for('xopcbot.error');
const USER_ERROR_MARKER = Symbol.for('xopcbot.error.user');
const CONFIG_ERROR_MARKER = Symbol.for('xopcbot.error.config');
const SYSTEM_ERROR_MARKER = Symbol.for('xopcbot.error.system');
const NETWORK_ERROR_MARKER = Symbol.for('xopcbot.error.network');
const PROVIDER_ERROR_MARKER = Symbol.for('xopcbot.error.provider');

export interface ErrorDetails {
  code: string;
  category: ErrorCategory;
  message: string;
  suggestion?: string;
  retryable?: boolean;
}

/**
 * Base error class for all xopcbot errors
 */
export class XopcbotError extends Error {
  public readonly [XOPCBOT_ERROR_MARKER] = true;
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly retryable: boolean;
  public readonly suggestion?: string;
  public readonly cause?: Error;

  constructor(details: ErrorDetails, cause?: Error) {
    super(details.message);
    this.name = 'XopcbotError';
    this.code = details.code;
    this.category = details.category;
    this.retryable = details.retryable ?? false;
    this.suggestion = details.suggestion;
    this.cause = cause;
    
    // Fix prototype chain
    Object.setPrototypeOf(this, XopcbotError.prototype);
  }

  /**
   * Format error for user display
   */
  toUserMessage(): string {
    let msg = `❌ ${this.message}`;
    if (this.suggestion) {
      msg += `\n💡 ${this.suggestion}`;
    }
    return msg;
  }

  /**
   * Format error for logging
   */
  toLogObject(): Record<string, unknown> {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      cause: this.cause?.message,
      stack: this.stack,
    };
  }
}

/**
 * User input/operation errors - caused by user actions
 */
export class UserError extends XopcbotError {
  public readonly [USER_ERROR_MARKER] = true;

  constructor(code: string, message: string, suggestion?: string, cause?: Error) {
    super({
      code: `USER_${code}`,
      category: 'user',
      message,
      suggestion,
      retryable: false,
    }, cause);
    this.name = 'UserError';
  }

  static invalidCommand(command: string): UserError {
    return new UserError(
      'INVALID_COMMAND',
      `Unknown command: "${command}"`,
      'Use /help to see available commands'
    );
  }

  static invalidInput(message: string, suggestion?: string): UserError {
    return new UserError('INVALID_INPUT', message, suggestion);
  }

  static unauthorized(message = 'You are not authorized to perform this action'): UserError {
    return new UserError('UNAUTHORIZED', message, 'Contact your administrator');
  }
}

/**
 * Configuration errors - caused by invalid/missing config
 */
export class ConfigError extends XopcbotError {
  public readonly [CONFIG_ERROR_MARKER] = true;

  constructor(code: string, message: string, suggestion?: string, cause?: Error) {
    super({
      code: `CONFIG_${code}`,
      category: 'config',
      message,
      suggestion,
      retryable: false,
    }, cause);
    this.name = 'ConfigError';
  }

  static missingApiKey(provider: string): ConfigError {
    return new ConfigError(
      'MISSING_API_KEY',
      `API key not configured for provider: ${provider}`,
      `Set ${provider.toUpperCase().replace(/-/g, '_')}_API_KEY environment variable or run 'xopcbot configure'`
    );
  }

  static invalidConfig(path: string, reason: string): ConfigError {
    return new ConfigError(
      'INVALID_CONFIG',
      `Invalid configuration at ${path}: ${reason}`,
      'Check your config.json or run xopcbot configure'
    );
  }

  static missingConfig(key: string): ConfigError {
    return new ConfigError(
      'MISSING_CONFIG',
      `Missing required configuration: ${key}`,
      'Run xopcbot configure to set up your configuration'
    );
  }
}

/**
 * System errors - internal/system-level failures
 */
export class SystemError extends XopcbotError {
  public readonly [SYSTEM_ERROR_MARKER] = true;

  constructor(code: string, message: string, retryable = false, suggestion?: string, cause?: Error) {
    super({
      code: `SYSTEM_${code}`,
      category: 'system',
      message,
      suggestion,
      retryable,
    }, cause);
    this.name = 'SystemError';
  }

  static internal(message: string, cause?: Error): SystemError {
    return new SystemError('INTERNAL', message, false, 'Please report this issue', cause);
  }

  static filesystem(path: string, operation: string, cause?: Error): SystemError {
    return new SystemError(
      'FILESYSTEM',
      `Failed to ${operation} at ${path}`,
      true,
      'Check file permissions and disk space',
      cause
    );
  }

  static outOfMemory(): SystemError {
    return new SystemError(
      'OUT_OF_MEMORY',
      'System ran out of memory',
      true,
      'Try reducing context size or restarting'
    );
  }
}

/**
 * Network errors - connectivity/timeout issues
 */
export class NetworkError extends XopcbotError {
  public readonly [NETWORK_ERROR_MARKER] = true;

  constructor(code: string, message: string, retryable = true, suggestion?: string, cause?: Error) {
    super({
      code: `NET_${code}`,
      category: 'network',
      message,
      suggestion,
      retryable,
    }, cause);
    this.name = 'NetworkError';
  }

  static timeout(url: string, timeoutMs: number, cause?: Error): NetworkError {
    return new NetworkError(
      'TIMEOUT',
      `Request to ${url} timed out after ${timeoutMs}ms`,
      true,
      'Check your internet connection or try again later',
      cause
    );
  }

  static connectionFailed(url: string, cause?: Error): NetworkError {
    return new NetworkError(
      'CONNECTION_FAILED',
      `Failed to connect to ${url}`,
      true,
      'Check your internet connection',
      cause
    );
  }
}

/**
 * LLM Provider errors - model/API failures
 */
export class ProviderError extends XopcbotError {
  public readonly [PROVIDER_ERROR_MARKER] = true;
  public readonly provider: string;
  public readonly model?: string;
  public readonly statusCode?: number;

  constructor(
    provider: string,
    code: string,
    message: string,
    retryable = false,
    suggestion?: string,
    cause?: Error,
    statusCode?: number,
    model?: string
  ) {
    super({
      code: `PROVIDER_${provider.toUpperCase().replace(/-/g, '_')}_${code}`,
      category: 'provider',
      message: `[${provider}] ${message}`,
      suggestion,
      retryable,
    }, cause);
    this.name = 'ProviderError';
    this.provider = provider;
    this.model = model;
    this.statusCode = statusCode;
  }

  static rateLimit(provider: string, retryAfter?: number, model?: string): ProviderError {
    const suggestion = retryAfter 
      ? `Wait ${retryAfter} seconds before retrying`
      : 'Retry after a short delay';
    
    return new ProviderError(
      provider,
      'RATE_LIMIT',
      'Rate limit exceeded',
      true,
      suggestion,
      undefined,
      429,
      model
    );
  }

  static authFailed(provider: string, cause?: Error): ProviderError {
    return new ProviderError(
      provider,
      'AUTH_FAILED',
      'Authentication failed - check your API key',
      false,
      `Verify your ${provider} API key is correct`,
      cause,
      401
    );
  }

  static modelNotFound(provider: string, model: string): ProviderError {
    return new ProviderError(
      provider,
      'MODEL_NOT_FOUND',
      `Model "${model}" not found`,
      false,
      'Check available models with /models command'
    );
  }

  static overloaded(provider: string, model?: string): ProviderError {
    return new ProviderError(
      provider,
      'OVERLOADED',
      'Provider is currently overloaded',
      true,
      'Retry after a short delay or try a different model',
      undefined,
      503,
      model
    );
  }

  static insufficientFunds(provider: string): ProviderError {
    return new ProviderError(
      provider,
      'INSUFFICIENT_FUNDS',
      'Insufficient funds or quota exceeded',
      false,
      'Check your account balance and billing settings'
    );
  }
}

/**
 * Error handling utilities
 */
export function isXopcbotError(error: unknown): error is XopcbotError {
  return error instanceof XopcbotError || 
    (error != null && typeof error === 'object' && XOPCBOT_ERROR_MARKER in error);
}

export function isUserError(error: unknown): error is UserError {
  return error instanceof UserError || 
    (error != null && typeof error === 'object' && USER_ERROR_MARKER in error);
}

export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError || 
    (error != null && typeof error === 'object' && CONFIG_ERROR_MARKER in error);
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError || 
    (error != null && typeof error === 'object' && PROVIDER_ERROR_MARKER in error);
}

export function isRetryable(error: unknown): boolean {
  if (isXopcbotError(error)) {
    return error.retryable;
  }
  // Default: network errors are retryable
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || 
           msg.includes('econnreset') || 
           msg.includes('enotfound') ||
           msg.includes('econnrefused');
  }
  return false;
}

/**
 * Wrap unknown error into XopcbotError
 */
export function wrapError(error: unknown, context?: string): XopcbotError {
  if (isXopcbotError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const prefix = context ? `${context}: ` : '';
  
  // Try to classify common errors
  const lowerMsg = message.toLowerCase();
  
  if (lowerMsg.includes('api key') || lowerMsg.includes('unauthorized') || lowerMsg.includes('401')) {
    return new ProviderError('unknown', 'AUTH_FAILED', prefix + message, false, 'Check your API key', error instanceof Error ? error : undefined);
  }
  
  if (lowerMsg.includes('timeout') || lowerMsg.includes('etimedout')) {
    return NetworkError.timeout('unknown', 30000, error instanceof Error ? error : undefined);
  }
  
  if (lowerMsg.includes('rate limit') || lowerMsg.includes('429')) {
    return ProviderError.rateLimit('unknown');
  }

  return SystemError.internal(prefix + message, error instanceof Error ? error : undefined);
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: unknown): string {
  if (isXopcbotError(error)) {
    return error.toUserMessage();
  }
  
  if (error instanceof Error) {
    return `❌ ${error.message}`;
  }
  
  return `❌ An unexpected error occurred: ${String(error)}`;
}

/**
 * Format error for logging
 */
export function formatErrorForLog(error: unknown): Record<string, unknown> {
  if (isXopcbotError(error)) {
    return error.toLogObject();
  }
  
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  
  return { error: String(error) };
}
