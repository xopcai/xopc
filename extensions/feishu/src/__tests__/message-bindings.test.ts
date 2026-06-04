import { describe, expect, it } from 'vitest';

import { getFeishuBindingByMessageId, recordFeishuMessageBinding } from '../state/message-bindings.js';

describe('message bindings', () => {
  it('records and retrieves bindings by messageId', () => {
    recordFeishuMessageBinding({
      messageId: 'm1',
      sessionKey: 'agent:main:feishu:default:direct:ou_x',
      accountId: 'default',
      chatId: 'oc_chat',
      senderId: 'ou_x',
      isGroup: true,
      threadId: 't1',
    });
    const b = getFeishuBindingByMessageId('m1');
    expect(b?.sessionKey).toBe('agent:main:feishu:default:direct:ou_x');
    expect(b?.threadId).toBe('t1');
  });
});

