import { createPublicKey, verify } from 'node:crypto';

export type DesktopFrameBinding = { gatewayId: string; deviceId: string; clientId: string; connectionInstanceId: string };

/** Optional Host-only extension; existing chat and local owner endpoints retain their wire path. */
export function signDesktopGatewayFrame(message: Record<string, unknown>, binding: DesktopFrameBinding, sequence: number,
  signPayload: (payload: string) => string): Record<string, unknown> {
  const signedPayload = Buffer.from(JSON.stringify({ purpose: 'desktop-gateway-frame-v1', ...binding, sequence, message })).toString('base64url');
  return { ...message, gatewayProof: { signedPayload, signature: signPayload(signedPayload) } };
}

export function verifyDesktopGatewayFrame(wire: string, binding: DesktopFrameBinding, publicKey: string, lastSequence: number, now = Date.now()): { sequence: number; message: any } {
  try {
    if (Buffer.byteLength(wire) > 768 * 1024) throw new Error();
    const { gatewayProof, ...message } = JSON.parse(wire);
    if (!gatewayProof || typeof gatewayProof.signedPayload !== 'string' || gatewayProof.signedPayload.length > 512 * 1024
      || typeof gatewayProof.signature !== 'string' || gatewayProof.signature.length > 128
      || !verify(null, Buffer.from(gatewayProof.signedPayload), createPublicKey(publicKey), Buffer.from(gatewayProof.signature, 'base64url'))) throw new Error();
    const proof = JSON.parse(Buffer.from(gatewayProof.signedPayload, 'base64url').toString());
    if (proof.purpose !== 'desktop-gateway-frame-v1' || !Number.isSafeInteger(proof.sequence) || proof.sequence !== lastSequence + 1
      || Object.entries(binding).some(([key, value]) => proof[key] !== value)
      || !Number.isSafeInteger(message.sentAt) || Math.abs(now - message.sentAt) > 60000
      || JSON.stringify(proof.message) !== JSON.stringify(message)
      || !['realtime.ready', 'endpoint.message'].includes(message.kind)) throw new Error();
    return { sequence: proof.sequence, message };
  } catch { throw new Error('DESKTOP_GATEWAY_FRAME_INVALID'); }
}
