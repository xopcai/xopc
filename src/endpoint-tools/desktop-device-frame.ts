import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

import { z } from 'zod';
import { clientEndpointMessageSchema, desktopDeviceFrameProofSchema, desktopExecutionBindingSchema,
  type ClientEndpointMessage, type DesktopExecutionBinding } from '@xopcai/endpoint-tools-protocol';

const MAX_WIRE_BYTES = 768 * 1024;
const signedSchema = desktopExecutionBindingSchema.extend({
  purpose: z.literal('desktop-device-frame-v1'), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  message: clientEndpointMessageSchema,
});
const wireSchema = z.strictObject({ message: clientEndpointMessageSchema, deviceProof: desktopDeviceFrameProofSchema });
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const current = (message: ClientEndpointMessage, now: number) => {
  if (!Number.isSafeInteger(now) || Math.abs(now - message.sentAt) > 60_000) throw new Error('DESKTOP_DEVICE_FRAME_INVALID');
};
const p256 = (key: KeyObject) => {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('DESKTOP_DEVICE_KEY_INVALID');
  return key;
};

/** Main-process-only signer. A connection owns its key reference and sequence. */
export class DesktopDeviceFrameSigner {
  private key?: KeyObject;
  private sequence = 0;
  private readonly binding: DesktopExecutionBinding;
  constructor(binding: DesktopExecutionBinding, privateKey: string) {
    this.binding = desktopExecutionBindingSchema.parse(binding);
    this.key = p256(createPrivateKey(privateKey));
  }
  sign(input: ClientEndpointMessage, now = Date.now()): string {
    if (!this.key) throw new Error('DESKTOP_DEVICE_FRAME_SIGNER_CLOSED');
    // Sign the serialized value the receiver will validate, never a mutable caller object.
    const message = clientEndpointMessageSchema.parse(JSON.parse(JSON.stringify(input)));
    current(message, now);
    const sequence = this.sequence + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error('DESKTOP_DEVICE_FRAME_SEQUENCE_EXHAUSTED');
    const signedPayload = encode({ ...this.binding, purpose: 'desktop-device-frame-v1', sequence, message });
    const deviceProof = desktopDeviceFrameProofSchema.parse({ signedPayload,
      signature: sign('sha256', Buffer.from(signedPayload), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url') });
    const wire = JSON.stringify({ message, deviceProof });
    if (Buffer.byteLength(wire) > MAX_WIRE_BYTES) throw new Error('DESKTOP_DEVICE_FRAME_TOO_LARGE');
    this.sequence = sequence;
    return wire;
  }
  close(): void { this.key = undefined; }
}

/** One instance per authenticated connection; invalid frames never advance its replay cursor. */
export class DesktopDeviceFrameVerifier {
  private sequence = 0;
  private readonly key: KeyObject;
  private readonly binding: DesktopExecutionBinding;
  constructor(binding: DesktopExecutionBinding, publicKey: string) {
    this.binding = desktopExecutionBindingSchema.parse(binding);
    this.key = p256(createPublicKey(publicKey));
  }
  verify(wire: string, now = Date.now()): ClientEndpointMessage {
    try {
      if (Buffer.byteLength(wire) > MAX_WIRE_BYTES) throw new Error();
      const { message, deviceProof } = wireSchema.parse(JSON.parse(wire));
      const { signedPayload, signature } = deviceProof;
      if (!verify('sha256', Buffer.from(signedPayload), { key: this.key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))) throw new Error();
      const payload = signedSchema.parse(JSON.parse(Buffer.from(signedPayload, 'base64url').toString('utf8')));
      if (encode(payload) !== signedPayload || payload.sequence !== this.sequence + 1
        || Object.entries(this.binding).some(([key, value]) => payload[key as keyof DesktopExecutionBinding] !== value)
        || JSON.stringify(payload.message) !== JSON.stringify(message)) throw new Error();
      current(message, now);
      this.sequence = payload.sequence;
      return message;
    } catch { throw new Error('DESKTOP_DEVICE_FRAME_INVALID'); }
  }
}
