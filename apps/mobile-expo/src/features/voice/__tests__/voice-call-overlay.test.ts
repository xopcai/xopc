import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({
  Platform: platform, Modal: 'NativeModal', View: 'NativeView', StyleSheet: { absoluteFill: {} },
}));
vi.mock('react-native-paper', () => ({ Portal: 'PaperPortal' }));
vi.mock('react-native-screens', () => ({ FullWindowOverlay: 'WindowOverlay' }));

import { VoiceCallOverlay } from '../VoiceCallOverlay';

afterEach(() => { platform.OS = 'ios'; });

describe('voice call presentation', () => {
  it('puts the expanded iOS call above native-stack modals with modal accessibility', () => {
    const result = VoiceCallOverlay({ expanded: true, onClose: vi.fn(), children: 'call' });
    expect(result.type).toBe('WindowOverlay');
    expect(result.props.unstable_accessibilityContainerViewIsModal).toBe(true);
    const container = result.props.children as ReactElement<Record<string, unknown>>;
    expect(container.type).toBe('NativeView');
    expect(container.props.accessibilityViewIsModal).toBe(true);
    expect(container.props.children).toBe('call');
  });
  it('keeps the iOS mini bar above settings without blocking underlying touches or accessibility', () => {
    const result = VoiceCallOverlay({ expanded: false, onClose: vi.fn(), children: 'mini' });
    expect(result.type).toBe('WindowOverlay');
    expect(result.props.unstable_accessibilityContainerViewIsModal).toBe(false);
    const container = result.props.children as ReactElement<Record<string, unknown>>;
    expect(container.props.pointerEvents).toBe('box-none');
    expect(container.props.accessibilityViewIsModal).toBe(false);
  });
  it('preserves Android modal back handling and the collapsed portal', () => {
    platform.OS = 'android';
    const onClose = vi.fn();
    const expanded = VoiceCallOverlay({ expanded: true, onClose, children: 'call' });
    expect(expanded.type).toBe('NativeModal');
    expect(expanded.props.onRequestClose).toBe(onClose);
    const collapsed = VoiceCallOverlay({ expanded: false, onClose, children: 'mini' });
    expect(collapsed.type).toBe('PaperPortal');
  });
});
