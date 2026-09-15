export class DiscussionServiceError extends Error {
  constructor(readonly code: 'invalid_input' | 'not_found' | 'conflict', message: string) {
    super(message);
    this.name = 'DiscussionServiceError';
  }
}
