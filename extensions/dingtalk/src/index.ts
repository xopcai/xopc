import { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';
import { createEnterpriseChannel, type EnterpriseMessage } from '@xopcai/xopc/channels/enterprise/plugin.js';
import type { EnterpriseCredentials, EnterpriseRegistration } from '@xopcai/xopc/channels/enterprise/setup.js';
import { postJson, record, runChannelSocket, string } from '@xopcai/xopc/channels/enterprise/socket.js';

const registrationBase = 'https://oapi.dingtalk.com/app/registration';
const api = 'https://api.dingtalk.com/v1.0';
const topic = '/v1.0/im/bot/messages/get';

async function registration(action: string, body: object, signal: AbortSignal) {
  const response = record(await postJson(`${registrationBase}/${action}`, body, signal));
  if (response.errcode !== 0) throw new Error('DingTalk registration request was rejected');
  return response;
}

async function begin(signal: AbortSignal): Promise<EnterpriseRegistration> {
  const init = await registration('init', { source: 'DING_DWS_CLAW' }, signal);
  if (!string(init.nonce)) throw new Error('DingTalk did not issue a registration nonce');
  const result = await registration('begin', { nonce: init.nonce }, signal);
  const code = string(result.device_code);
  const qrPayload = string(result.verification_uri_complete);
  if (!code || new URL(qrPayload).protocol !== 'https:') throw new Error('DingTalk did not issue a setup QR');
  return {
    qrPayload,
    expiresInSec: Math.min(600, Math.max(1, Number(result.expires_in) || 300)),
    intervalMs: Math.min(15_000, Math.max(1000, (Number(result.interval) || 3) * 1000)),
    async poll(pollSignal) {
      const state = await registration('poll', { device_code: code }, pollSignal);
      if (state.status === 'EXPIRED' || state.status === 'FAIL') return 'expired';
      if (state.status !== 'SUCCESS') return;
      const credentials = { id: string(state.client_id), secret: string(state.client_secret) };
      return credentials.id && credentials.secret ? credentials : 'expired';
    },
  };
}

async function streamEndpoint(credentials: EnterpriseCredentials, signal?: AbortSignal) {
  const result = record(await postJson(`${api}/gateway/connections/open`, {
    clientId: credentials.id,
    clientSecret: credentials.secret,
    ua: 'xopc',
    subscriptions: [{ type: 'CALLBACK', topic }],
  }, signal));
  const endpoint = new URL(string(result.endpoint));
  const ticket = string(result.ticket);
  if (endpoint.protocol !== 'wss:' || !ticket) throw new Error('Invalid DingTalk Stream endpoint');
  endpoint.searchParams.set('ticket', ticket);
  return endpoint.href;
}

function parseMessage(value: unknown): EnterpriseMessage | undefined {
  const body = record(value);
  const type = String(body.conversationType);
  if (body.msgtype !== 'text' || (type !== '1' && type !== '2')) return;
  // Stream robot callbacks only deliver group messages addressed to the robot.
  if (type === '2' && body.isInAtList === false) return;
  const senderId = string(body.senderStaffId) || string(body.senderId);
  const groupId = type === '2' ? string(body.conversationId) : undefined;
  const messageId = string(body.msgId);
  const text = string(record(body.text).content);
  if (senderId && messageId && text && (type === '1' || groupId)) return { senderId, groupId, messageId, text };
}

function transport(credentials: EnterpriseCredentials, receive: (message: EnterpriseMessage) => Promise<void>) {
  let token: { value: string; expiresAt: number } | undefined;
  let tokenRequest: Promise<string> | undefined;
  const getToken = async () => {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    tokenRequest ??= postJson(`${api}/oauth2/accessToken`, {
      appKey: credentials.id, appSecret: credentials.secret,
    }).then((data) => {
      const response = record(data);
      const value = string(response.accessToken);
      if (!value) throw new Error('DingTalk did not issue an access token');
      token = { value, expiresAt: Date.now() + (Number(response.expireIn) || 0) * 1000 };
      return value;
    }).finally(() => { tokenRequest = undefined; });
    return tokenRequest;
  };

  return {
    run(signal: AbortSignal, online: Parameters<typeof runChannelSocket>[2], onFailure: () => void) {
      return runChannelSocket(signal, async () => ({
        endpoint: await streamEndpoint(credentials, signal),
        async receive(frame, socket) {
          const envelope = record(frame);
          const headers = record(envelope.headers);
          const callbackId = string(headers.messageId);
          if (!callbackId) return;
          if (envelope.type === 'SYSTEM' && (headers.topic === 'ping' || headers.topic === 'disconnect')) {
            socket.send(JSON.stringify({ code: 200, headers, message: 'OK', data: envelope.data }),
              () => { if (headers.topic === 'disconnect') socket.close(); });
          }
          if (envelope.type !== 'CALLBACK' || headers.topic !== topic) return;
          let payload: unknown;
          try {
            payload = typeof envelope.data === 'string' ? JSON.parse(envelope.data) : envelope.data;
          } catch {
            payload = undefined;
          }
          const message = parseMessage(payload);
          if (message) await receive(message);
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({
            code: 200, headers: { messageId: callbackId, contentType: 'application/json' },
            message: 'OK', data: JSON.stringify({ response: {} }),
          }));
        },
      }), online, onFailure);
    },
    async send(target: string, group: boolean, text: string) {
      const accessToken = await getToken();
      const route = group ? 'groupMessages/send' : 'oToMessages/batchSend';
      const response = record(await postJson(`${api}/robot/${route}`, {
        robotCode: credentials.id,
        ...(group ? { openConversationId: target } : { userIds: [target] }),
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content: text }),
      }, undefined, { 'x-acs-dingtalk-access-token': accessToken }));
      const id = string(response.processQueryKey);
      if (!id) throw new Error('DingTalk did not confirm message delivery');
      return id;
    },
  };
}

export const dingtalkPlugin = createEnterpriseChannel({
  id: 'dingtalk', label: 'DingTalk', order: 40,
  credentialFields: ['clientId', 'clientSecret'], credentialLabels: ['Client ID', 'Client Secret'],
  begin, verify: async (credentials) => { await streamEndpoint(credentials); }, transport,
});

export default defineChannelPluginEntry({ id: 'dingtalk', name: 'DingTalk', plugin: dingtalkPlugin });
