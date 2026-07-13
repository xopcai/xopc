import { describe, expect, it } from 'vitest';

import { noteEditorModeFromInteraction } from '../editor/editor-interaction';

describe('noteEditorModeFromInteraction', () => {
  it('keeps native presentations authoritative over delayed editor blur and focus events', () => {
    expect(noteEditorModeFromInteraction({ focused: true, presentation: 'opening' })).toBe('native_modal');
    expect(noteEditorModeFromInteraction({ focused: false, presentation: 'open' })).toBe('native_modal');
  });

  it('returns to the latest editor focus state after a presentation closes', () => {
    expect(noteEditorModeFromInteraction({ focused: true, presentation: 'none' })).toBe('editing');
    expect(noteEditorModeFromInteraction({ focused: false, presentation: 'none' })).toBe('viewing');
  });
});
