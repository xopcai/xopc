import { describe, it, expect } from 'vitest';
import {
  XopcbotError,
  UserError,
  ConfigError,
  SystemError,
  NetworkError,
  ProviderError,
  isXopcbotError,
  isUserError,
  isConfigError,
  isProviderError,
  isRetryable,
  wrapError,
  formatErrorForUser,
  formatErrorForLog,
} from '../index.js';

describe('XopcbotError', () => {
  it('should create base error with all properties', () => {
    const error = new XopcbotError({
      code: 'TEST_001',
      category: 'system',
      message: 'Test error',
      suggestion: 'Try again',
      retryable: true,
    });

    expect(error.code).toBe('TEST_001');
    expect(error.category).toBe('system');
    expect(error.message).toBe('Test error');
    expect(error.suggestion).toBe('Try again');
    expect(error.retryable).toBe(true);
  });

  it('should format user message', () => {
    const error = new XopcbotError({
      code: 'TEST',
      category: 'user',
      message: 'Something went wrong',
      suggestion: 'Fix it',
    });

    const msg = error.toUserMessage();
    expect(msg).toContain('❌');
    expect(msg).toContain('Something went wrong');
    expect(msg).toContain('💡');
    expect(msg).toContain('Fix it');
  });

  it('should format log object', () => {
    const error = new XopcbotError({
      code: 'TEST',
      category: 'system',
      message: 'Error',
    });

    const log = error.toLogObject();
    expect(log.code).toBe('TEST');
    expect(log.category).toBe('system');
    expect(log.message).toBe('Error');
  });
});

describe('UserError', () => {
  it('should create user error', () => {
    const error = new UserError('INVALID', 'Invalid input', 'Try again');
    
    expect(error.code).toBe('USER_INVALID');
    expect(error.category).toBe('user');
    expect(error.retryable).toBe(false);
  });

  it('should create invalidCommand error', () => {
    const error = UserError.invalidCommand('/unknown');
    
    expect(error.code).toBe('USER_INVALID_COMMAND');
    expect(error.message).toContain('/unknown');
    expect(error.suggestion).toContain('/help');
  });

  it('should create invalidInput error', () => {
    const error = UserError.invalidInput('Missing field', 'Add the field');
    
    expect(error.code).toBe('USER_INVALID_INPUT');
    expect(error.message).toBe('Missing field');
    expect(error.suggestion).toBe('Add the field');
  });

  it('should create unauthorized error', () => {
    const error = UserError.unauthorized();
    
    expect(error.code).toBe('USER_UNAUTHORIZED');
    expect(error.message).toContain('not authorized');
  });
});

describe('ConfigError', () => {
  it('should create config error', () => {
    const error = new ConfigError('INVALID', 'Invalid config', 'Fix it');
    
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.category).toBe('config');
  });

  it('should create missingApiKey error', () => {
    const error = ConfigError.missingApiKey('openai');
    
    expect(error.code).toBe('CONFIG_MISSING_API_KEY');
    expect(error.message).toContain('openai');
    expect(error.message).toContain('API key');
    expect(error.suggestion).toContain('OPENAI_API_KEY');
  });

  it('should create invalidConfig error', () => {
    const error = ConfigError.invalidConfig('providers.openai', 'missing baseUrl');
    
    expect(error.code).toBe('CONFIG_INVALID_CONFIG');
    expect(error.message).toContain('providers.openai');
  });

  it('should create missingConfig error', () => {
    const error = ConfigError.missingConfig('model');
    
    expect(error.code).toBe('CONFIG_MISSING_CONFIG');
    expect(error.message).toContain('model');
  });
});

describe('SystemError', () => {
  it('should create system error', () => {
    const error = new SystemError('FAILURE', 'System failed', true, 'Retry');
    
    expect(error.code).toBe('SYSTEM_FAILURE');
    expect(error.category).toBe('system');
    expect(error.retryable).toBe(true);
  });

  it('should create internal error', () => {
    const cause = new Error('Original');
    const error = SystemError.internal('Something broke', cause);
    
    expect(error.code).toBe('SYSTEM_INTERNAL');
    expect(error.retryable).toBe(false);
    expect(error.cause).toBe(cause);
  });

  it('should create filesystem error', () => {
    const cause = new Error('Permission denied');
    const error = SystemError.filesystem('/path', 'read', cause);
    
    expect(error.code).toBe('SYSTEM_FILESYSTEM');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('/path');
    expect(error.message).toContain('read');
  });

  it('should create outOfMemory error', () => {
    const error = SystemError.outOfMemory();
    
    expect(error.code).toBe('SYSTEM_OUT_OF_MEMORY');
    expect(error.retryable).toBe(true);
  });
});

describe('NetworkError', () => {
  it('should create network error', () => {
    const error = new NetworkError('FAILURE', 'Network failed');
    
    expect(error.code).toBe('NET_FAILURE');
    expect(error.category).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('should create timeout error', () => {
    const error = NetworkError.timeout('api.example.com', 5000);
    
    expect(error.code).toBe('NET_TIMEOUT');
    expect(error.message).toContain('api.example.com');
    expect(error.message).toContain('5000ms');
  });

  it('should create connectionFailed error', () => {
    const error = NetworkError.connectionFailed('api.example.com');
    
    expect(error.code).toBe('NET_CONNECTION_FAILED');
    expect(error.message).toContain('api.example.com');
  });
});

describe('ProviderError', () => {
  it('should create provider error', () => {
    const error = new ProviderError('openai', 'ERROR', 'Something wrong');
    
    expect(error.code).toBe('PROVIDER_OPENAI_ERROR');
    expect(error.provider).toBe('openai');
  });

  it('should create rateLimit error', () => {
    const error = ProviderError.rateLimit('openai', 60, 'gpt-4');
    
    expect(error.code).toBe('PROVIDER_OPENAI_RATE_LIMIT');
    expect(error.statusCode).toBe(429);
    expect(error.model).toBe('gpt-4');
    expect(error.suggestion).toContain('60');
  });

  it('should create rateLimit error without retryAfter', () => {
    const error = ProviderError.rateLimit('openai');
    
    expect(error.suggestion).toContain('Retry');
    expect(error.suggestion).not.toContain('seconds');
  });

  it('should create authFailed error', () => {
    const cause = new Error('401');
    const error = ProviderError.authFailed('anthropic', cause);
    
    expect(error.code).toBe('PROVIDER_ANTHROPIC_AUTH_FAILED');
    expect(error.statusCode).toBe(401);
    expect(error.cause).toBe(cause);
  });

  it('should create modelNotFound error', () => {
    const error = ProviderError.modelNotFound('google', 'gemini-100');
    
    expect(error.code).toBe('PROVIDER_GOOGLE_MODEL_NOT_FOUND');
    expect(error.message).toContain('gemini-100');
  });

  it('should create overloaded error', () => {
    const error = ProviderError.overloaded('openai', 'gpt-4');
    
    expect(error.code).toBe('PROVIDER_OPENAI_OVERLOADED');
    expect(error.statusCode).toBe(503);
    expect(error.retryable).toBe(true);
  });

  it('should create insufficientFunds error', () => {
    const error = ProviderError.insufficientFunds('openai');
    
    expect(error.code).toBe('PROVIDER_OPENAI_INSUFFICIENT_FUNDS');
    expect(error.retryable).toBe(false);
  });
});

describe('Type guards', () => {
  it('isXopcbotError should return true for XopcbotError', () => {
    expect(isXopcbotError(new UserError('TEST', 'test'))).toBe(true);
    expect(isXopcbotError(new Error())).toBe(false);
    expect(isXopcbotError('string')).toBe(false);
    expect(isXopcbotError(null)).toBe(false);
  });

  it('isUserError should return true only for UserError', () => {
    expect(isUserError(new UserError('TEST', 'test'))).toBe(true);
    expect(isUserError(new ConfigError('TEST', 'test'))).toBe(false);
    expect(isUserError(new Error())).toBe(false);
  });

  it('isConfigError should return true only for ConfigError', () => {
    expect(isConfigError(new ConfigError('TEST', 'test'))).toBe(true);
    expect(isConfigError(new UserError('TEST', 'test'))).toBe(false);
  });

  it('isProviderError should return true only for ProviderError', () => {
    expect(isProviderError(new ProviderError('test', 'CODE', 'msg'))).toBe(true);
    expect(isProviderError(new SystemError('CODE', 'msg'))).toBe(false);
  });
});

describe('isRetryable', () => {
  it('should return retryable for XopcbotError', () => {
    const retryable = new SystemError('TEST', 'test', true);
    const notRetryable = new UserError('TEST', 'test');
    
    expect(isRetryable(retryable)).toBe(true);
    expect(isRetryable(notRetryable)).toBe(false);
  });

  it('should detect retryable from error message', () => {
    expect(isRetryable(new Error('Connection timeout'))).toBe(true);
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryable(new Error('ENOTFOUND'))).toBe(true);
    expect(isRetryable(new Error('ECONNREFUSED'))).toBe(true);
  });

  it('should return false for unknown errors', () => {
    expect(isRetryable('string')).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(new Error('Some random error'))).toBe(false);
  });
});

describe('wrapError', () => {
  it('should return XopcbotError as-is', () => {
    const original = new UserError('TEST', 'test');
    const wrapped = wrapError(original);
    
    expect(wrapped).toBe(original);
  });

  it('should wrap api key errors as ProviderError', () => {
    const error = new Error('Invalid API key provided');
    const wrapped = wrapError(error);
    
    expect(isProviderError(wrapped)).toBe(true);
    expect(wrapped.code).toContain('AUTH_FAILED');
  });

  it('should wrap timeout errors as NetworkError', () => {
    const error = new Error('Request ETIMEDOUT');
    const wrapped = wrapError(error);
    
    expect(wrapped.code).toBe('NET_TIMEOUT');
  });

  it('should wrap rate limit errors as ProviderError', () => {
    const error = new Error('429 rate limit exceeded');
    const wrapped = wrapError(error);
    
    expect(isProviderError(wrapped)).toBe(true);
  });

  it('should wrap unknown errors as SystemError', () => {
    const error = new Error('Something weird');
    const wrapped = wrapError(error, 'Context');
    
    expect(wrapped.code).toBe('SYSTEM_INTERNAL');
    expect(wrapped.message).toContain('Context');
    expect(wrapped.cause).toBe(error);
  });

  it('should handle string errors', () => {
    const wrapped = wrapError('something broke');
    
    expect(wrapped.code).toBe('SYSTEM_INTERNAL');
    expect(wrapped.message).toContain('something broke');
  });

  it('should handle null errors', () => {
    const wrapped = wrapError(null);
    
    expect(wrapped.code).toBe('SYSTEM_INTERNAL');
  });
});

describe('formatErrorForUser', () => {
  it('should format XopcbotError with suggestion', () => {
    const error = new UserError('TEST', 'Something wrong', 'Do this');
    const formatted = formatErrorForUser(error);
    
    expect(formatted).toContain('❌');
    expect(formatted).toContain('Something wrong');
    expect(formatted).toContain('💡');
    expect(formatted).toContain('Do this');
  });

  it('should format regular Error', () => {
    const error = new Error('Regular error');
    const formatted = formatErrorForUser(error);
    
    expect(formatted).toContain('❌');
    expect(formatted).toContain('Regular error');
  });

  it('should handle unknown errors', () => {
    const formatted = formatErrorForUser(12345);
    
    expect(formatted).toContain('❌');
    expect(formatted).toContain('12345');
  });
});

describe('formatErrorForLog', () => {
  it('should format XopcbotError', () => {
    const error = new UserError('TEST', 'message');
    const formatted = formatErrorForLog(error);
    
    expect(formatted.code).toBe('USER_TEST');
    expect(formatted.category).toBe('user');
  });

  it('should format regular Error', () => {
    const error = new Error('test');
    error.stack = 'stack trace';
    const formatted = formatErrorForLog(error);
    
    expect(formatted.name).toBe('Error');
    expect(formatted.message).toBe('test');
    expect(formatted.stack).toBe('stack trace');
  });

  it('should handle primitives', () => {
    const formatted = formatErrorForLog('string error');
    
    expect(formatted.error).toBe('string error');
  });
});
