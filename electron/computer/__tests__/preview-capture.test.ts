import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), desktopCapturer: {}, MessageChannelMain: vi.fn() }));
import { exactPreviewSource } from '../preview-capture.js';

describe('exact native preview source', () => {
  it('matches the external native window ID without using titles or desktop sources', () => {
    expect(exactPreviewSource([{ id: 'window:9:0' }, { id: 'window:10:0' }, { id: 'screen:9:0' }], '9')).toBe('window:9:0');
  });
  it.each([{ sources: [{ id: 'window:9:1' }] }, { sources: [{ id: 'screen:9:0' }] }, { sources: [{ id: 'window:9:0' }, { id: 'window:9:0' }] }])('refuses unavailable or ambiguous sources', ({ sources }) => {
    expect(() => exactPreviewSource(sources, '9')).toThrow('EXACT_WINDOW_UNAVAILABLE');
  });
});
