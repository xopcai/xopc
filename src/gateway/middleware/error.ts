import { createResponse, type GatewayResponse } from '../protocol.js';

export function handleError(error: unknown, requestId: string): GatewayResponse {
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';

  if (error instanceof Error) {
    message = error.message;
    
    // Categorize common errors
    if (message.includes('not found') || message.includes('NotFound')) {
      code = 'NOT_FOUND';
    } else if (message.includes('unauthorized') || message.includes('auth')) {
      code = 'UNAUTHORIZED';
    } else if (message.includes('missing') || message.includes('Missing')) {
      code = 'BAD_REQUEST';
    }
  }

  return createResponse(requestId, undefined, { code, message });
}
