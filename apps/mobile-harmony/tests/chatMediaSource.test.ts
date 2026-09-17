import { describe, expect, it } from 'vitest';
import { chatMediaSource, CHAT_MEDIA_LIMIT } from '../entry/src/main/ets/common/chatMediaSource.ets';

describe('chat media source isolation', () => {
  it('scopes media reads to the conversation and escapes all identifiers', () => {
    expect(chatMediaSource('media://a/b', 'c&d')).toEqual({ external: false, path: '/api/media/read?uri=media%3A%2F%2Fa%2Fb&conversationId=c%26d' });
    expect(chatMediaSource('xopc-file:a%2Fb', '')).toEqual({ external: false, path: '/api/files/a%2Fb/content' });
  });
  it('decodes image data without accessing the gateway', () => {
    expect(new Uint8Array(chatMediaSource('data:image/png;base64,YWJj', '').data!)).toEqual(new Uint8Array([97, 98, 99]));
  });
  it.each(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf'])('allows bounded embedded document data: %s', mime => {
    expect(new Uint8Array(chatMediaSource(`data:${mime};base64,YWJj`, '').data!)).toEqual(new Uint8Array([97, 98, 99]));
  });
  it('never authenticates externally supplied URLs', () => {
    expect(chatMediaSource('https://example.com/p.png', 'c')).toEqual({ external: true, path: 'https://example.com/p.png' });
  });
  it.each(['file:///etc/passwd', '/api/config', 'http://external.test/a', 'javascript:alert(1)', 'media://a', 'xopc-file:', 'data:text/html;base64,YQ==', 'data:image/png;base64,%%%'])('rejects unsafe or incomplete source %s', uri => {
    expect(() => chatMediaSource(uri, '')).toThrow();
  });
  it('rejects oversized embedded media before decoding', () => {
    expect(() => chatMediaSource('data:image/png;base64,' + 'a'.repeat(Math.ceil(CHAT_MEDIA_LIMIT * 1.4) + 1), '')).toThrow('INVALID_MEDIA_OR_TOO_LARGE');
  });
});
