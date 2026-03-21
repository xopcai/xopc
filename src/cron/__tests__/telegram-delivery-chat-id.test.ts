import { describe, it, expect } from 'vitest';
import { normalizeTelegramDeliveryChatId } from '../telegram-delivery-chat-id.js';

describe('normalizeTelegramDeliveryChatId', () => {
  it('passes through plain numeric chat id', () => {
    expect(normalizeTelegramDeliveryChatId('916534770')).toBe('916534770');
  });

  it('strips full telegram session key to peer id', () => {
    expect(normalizeTelegramDeliveryChatId('main:telegram:default:dm:916534770')).toBe(
      '916534770'
    );
  });

  it('maps mistaken account:dm:peer suffix to peer id', () => {
    expect(normalizeTelegramDeliveryChatId('default:dm:916534770')).toBe('916534770');
  });

  it('maps account:group:peer for supergroups', () => {
    expect(normalizeTelegramDeliveryChatId('default:group:-1001234567890')).toBe(
      '-1001234567890'
    );
  });
});
