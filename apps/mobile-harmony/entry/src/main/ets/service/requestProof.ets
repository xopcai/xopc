import { http } from '@kit.NetworkKit';
import { XopcDeviceCrypto } from './deviceCrypto';

interface ProofBinding { gatewayId: string; crypto: XopcDeviceCrypto; offsetMs: number; }
interface ProofHeaders { 'X-Xopc-Proof': string; }
const tokenBindings: Map<string, ProofBinding> = new Map<string, ProofBinding>();
const originBindings: Map<string, ProofBinding> = new Map<string, ProofBinding>();

export function registerRequestProof(token: string, gatewayId: string, origins: string[], crypto: XopcDeviceCrypto, offsetMs: number = 0): void {
  const binding: ProofBinding = { gatewayId, crypto, offsetMs };
  tokenBindings.set(token, binding);
  origins.forEach((origin: string): void => { originBindings.set(origin.replace(/\/$/, ''), binding); });
  if (tokenBindings.size > 128) { const current = tokenBindings.get(token)!; tokenBindings.clear(); tokenBindings.set(token, current); }
}

async function makeProof(binding: ProofBinding, credential: string, method: string, path: string,
  bytes: Uint8Array, headers: string[]): Promise<string> {
  const timestamp = Date.now() + binding.offsetMs; const nonce = await binding.crypto.nonce(); const bodyHash = await binding.crypto.digest(bytes);
  const fields: string[] = ['xopc-request-v1', binding.gatewayId, await binding.crypto.digest(binding.crypto.encodeText(credential)), method, path, bodyHash];
  const message = fields.concat(headers).concat([timestamp.toString(), nonce]).join('\n');
  return timestamp + '.' + nonce + '.' + bodyHash + '.' + await binding.crypto.sign(message);
}

export async function connectionProof(url: string, ticket: string): Promise<ProofHeaders> {
  const origin = url.replace(/^wss:/, 'https:').split('/').slice(0, 3).join('/');
  const binding = originBindings.get(origin);
  if (!binding) throw new Error('DEVICE_PROOF_CONTEXT_MISSING');
  const path = '/' + url.split('/').slice(3).join('/');
  return { 'X-Xopc-Proof': await makeProof(binding, ticket, 'CONNECT', path, new Uint8Array(0), ['', '', '', '', '']) };
}

function multipart(parts: http.MultiFormData[], boundary: string, crypto: XopcDeviceCrypto): Uint8Array {
  const chunks: Uint8Array[] = [];
  parts.forEach((part: http.MultiFormData): void => {
    const name = part.name.replace(/[\r\n"\\]/g, '_');
    const file = part.remoteFileName ? '; filename="' + part.remoteFileName.replace(/[\r\n"\\]/g, '_') + '"' : '';
    chunks.push(crypto.encodeText('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"' + file
      + '\r\nContent-Type: ' + (part.contentType ?? 'application/octet-stream') + '\r\n\r\n'));
    if (typeof part.data === 'string') chunks.push(crypto.encodeText(part.data));
    else if (part.data instanceof ArrayBuffer) chunks.push(new Uint8Array(part.data));
    else throw new Error('UNSUPPORTED_MULTIPART_BODY');
    chunks.push(crypto.encodeText('\r\n'));
  });
  chunks.push(crypto.encodeText('--' + boundary + '--\r\n'));
  let length = 0; chunks.forEach((chunk: Uint8Array): void => { length += chunk.length; });
  const bytes = new Uint8Array(length); let offset = 0;
  chunks.forEach((chunk: Uint8Array): void => { bytes.set(chunk, offset); offset += chunk.length; });
  return bytes;
}

/** Signs finalized bytes so the native multipart encoder cannot change the digest. */
export async function signedHttpRequest(connection: http.HttpRequest, url: string, options: http.HttpRequestOptions): Promise<http.HttpResponse> {
  const headers = options.header as Record<string, string>;
  const authorization = headers ? (headers['Authorization'] ?? headers['authorization'] ?? '') : '';
  if (!authorization.startsWith('Bearer xopc_at_')) return connection.request(url, options);
  const token = authorization.slice(7); const binding = tokenBindings.get(token);
  if (!binding) throw new Error('DEVICE_PROOF_CONTEXT_MISSING');
  const origin = url.split('/').slice(0, 3).join('/');
  if (originBindings.get(origin)?.gatewayId !== binding.gatewayId) throw new Error('GATEWAY_IDENTITY_MISMATCH');
  let bytes: Uint8Array = new Uint8Array(0);
  if (options.multiFormDataList) {
    const boundary = 'xopc-' + binding.crypto.uuid();
    bytes = multipart(options.multiFormDataList, boundary, binding.crypto);
    headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
    options.multiFormDataList = undefined; options.extraData = bytes.buffer;
  } else if (typeof options.extraData === 'string') bytes = binding.crypto.encodeText(options.extraData);
  else if (options.extraData instanceof ArrayBuffer) bytes = new Uint8Array(options.extraData);
  else if (options.extraData !== undefined) throw new Error('UNSUPPORTED_REQUEST_BODY');
  const path = '/' + url.split('/').slice(3).join('/');
  headers['X-Xopc-Proof'] = await makeProof(binding, token, options.customMethod ?? options.method ?? 'GET', path, bytes,
    ['Content-Type', 'Idempotency-Key', 'X-Xopc-Expected-Session-Key', 'x-endpoint-id', 'x-endpoint-upload-token']
      .map((name: string): string => headers[name] ?? headers[name.toLowerCase()] ?? ''));
  return connection.request(url, options);
}
