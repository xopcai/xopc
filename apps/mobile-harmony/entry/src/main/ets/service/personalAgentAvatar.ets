import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { gatewaySession } from './gatewaySession';

const AVATAR_LIMIT: number = 512 * 1024;

function avatarMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
    && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return 'image/webp';
  return '';
}

export async function fetchPersonalAgentAvatar(agentId: string, reference: string | undefined = undefined): Promise<string> {
  if (!agentId) return '';
  const revision = gatewaySession.connectionRevision();
  const auth = await gatewaySession.transferAuth();
  gatewaySession.assertConnection(revision);
  const request = http.createHttp();
  const headers: Record<string, string> = {};
  if (!reference?.startsWith('https://')) headers['Authorization'] = 'Bearer ' + auth.token;
  try {
    const response = await request.request(reference?.startsWith('https://') ? reference : auth.origin + '/api/agents/' + encodeURIComponent(agentId) + '/avatar' + (reference !== undefined ? '?resolve=1' : ''), {
      method: http.RequestMethod.GET,
      header: headers,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      maxRedirects: 0,
      maxLimit: AVATAR_LIMIT,
      connectTimeout: 8000,
      readTimeout: 30000,
      usingCache: false
    });
    gatewaySession.assertConnection(revision);
    if (response.responseCode !== 200 || !(response.result instanceof ArrayBuffer)
      || response.result.byteLength === 0 || response.result.byteLength > AVATAR_LIMIT) return '';
    const bytes = new Uint8Array(response.result);
    const mime = avatarMime(bytes);
    return mime ? 'data:' + mime + ';base64,' + new util.Base64Helper().encodeToStringSync(bytes) : '';
  } finally { request.destroy(); }
}
