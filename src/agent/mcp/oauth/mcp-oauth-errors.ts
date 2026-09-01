import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

export class McpAuthorizationRequiredError extends Error {
  readonly code = 'MCP_AUTHORIZATION_REQUIRED';

  constructor(message = 'MCP server authorization is required') {
    super(message);
    this.name = 'McpAuthorizationRequiredError';
  }
}

export function isMcpAuthorizationError(error: unknown): boolean {
  return error instanceof UnauthorizedError || error instanceof McpAuthorizationRequiredError;
}
