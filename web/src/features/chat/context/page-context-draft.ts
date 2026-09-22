import { create } from 'zustand';
import { parseAppContextEnvelope, type AppContextEnvelope } from '@xopcai/gateway-contract';

export interface PageContextDraft {
  envelope: AppContextEnvelope;
  title: string;
  preview: string;
  truncated: boolean;
}

/** Memory only: no page content in URLs, persistent storage, or cross-tab channels. */
export function createPageContextDraftStore() {
  const clientInstanceId = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  let sequence = 0;
  const store = create<{ drafts: Record<string, PageContextDraft> }>(() => ({ drafts: {} }));
  return {
    store,
    capture(input: {
      title: string; text: string; resourceRefs: AppContextEnvelope['resourceRefs'];
      selection?: AppContextEnvelope['selection'];
    }): PageContextDraft {
      return {
        envelope: parseAppContextEnvelope({ version: 1, clientInstanceId, tabId, sequence: ++sequence,
          surface: 'web', capturedAt: Date.now(), resourceRefs: input.resourceRefs, selection: input.selection }),
        title: input.title, preview: input.text.slice(0, 16000), truncated: input.text.length > 16000,
      };
    },
    put(key: string, draft: PageContextDraft): boolean {
      const drafts = store.getState().drafts;
      if (drafts[key] || Object.keys(drafts).length >= 20) return false;
      store.setState({ drafts: { ...drafts, [key]: structuredClone(draft) } });
      return true;
    },
    remove(key: string, expected: PageContextDraft): void {
      const drafts = store.getState().drafts;
      if (drafts[key] !== expected) return;
      const next = { ...drafts };
      delete next[key];
      store.setState({ drafts: next });
    },
  };
}

export const pageContextDrafts = createPageContextDraftStore();
export function pageContextDraftKey(baseUrl: string, authNamespace: string | undefined, conversationId: string): string {
  return JSON.stringify([baseUrl, authNamespace ?? null, conversationId]);
}
