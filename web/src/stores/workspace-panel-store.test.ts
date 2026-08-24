import { beforeEach, describe, expect, it } from 'vitest';

import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';

describe('workspace panel session scope', () => {
  beforeEach(() => {
    useWorkspacePanelStore.setState({ open: false, sessionKeyOverride: null });
  });

  it('opens for the requested embedded chat session', () => {
    useWorkspacePanelStore.getState().openForSession('  agent:main:webchat:task-1  ');

    expect(useWorkspacePanelStore.getState()).toMatchObject({
      open: true,
      sessionKeyOverride: 'agent:main:webchat:task-1',
    });
  });

  it('clears the session override when the panel closes', () => {
    useWorkspacePanelStore.getState().openForSession('agent:main:webchat:task-1');
    useWorkspacePanelStore.getState().setOpen(false);

    expect(useWorkspacePanelStore.getState()).toMatchObject({
      open: false,
      sessionKeyOverride: null,
    });
  });
});
