import type { CapabilityErrorCode } from '@xopcai/gateway-contract';

export class CapabilityError extends Error {
  constructor(readonly code: CapabilityErrorCode, message: string, readonly operationId?: string) {
    super(message);
    this.name = 'CapabilityError';
  }
}
