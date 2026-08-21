import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import {
  fetchAgentProfileFileContent,
  saveAgentProfileFileContent,
} from '@/features/settings/agents-admin-api';
import { useAsyncResource } from '@/lib/use-async-resource';
import { useAutosave } from '@/lib/use-autosave';

import {
  type IdentityFields,
  type SoulTemplateId,
  detectSoulTemplate,
  parseIdentityMarkdown,
  serializeIdentityMarkdown,
  SOUL_TEMPLATES,
} from '../agent-profile-markdown';

type OverviewProfileLoaded = {
  identity: IdentityFields;
  soulTemplate: SoulTemplateId;
  soulCustomContent: string;
  identityBaseline: string;
  soulBaseline: string;
};

export type OverviewProfileDraft = OverviewProfileLoaded & {
  soulEditorNonce: number;
  soulPreviewMode: boolean;
  avatarDialogOpen: boolean;
};

function draftFromLoaded(loaded: OverviewProfileLoaded): OverviewProfileDraft {
  return {
    ...loaded,
    soulEditorNonce: 0,
    soulPreviewMode: false,
    avatarDialogOpen: false,
  };
}

export function useAgentOverviewProfileMarkdown(options: {
  agentId: string | null;
  enabled: boolean;
  saveRef?: MutableRefObject<(() => Promise<void>) | null>;
}) {
  const { agentId, enabled, saveRef } = options;

  const loadedResource = useAsyncResource(
    async (): Promise<OverviewProfileLoaded | null> => {
      if (!agentId) return null;
      const [identityMd, soulMd] = await Promise.all([
        fetchAgentProfileFileContent(agentId, 'IDENTITY.md').catch(() => ''),
        fetchAgentProfileFileContent(agentId, 'SOUL.md').catch(() => ''),
      ]);
      const identity = parseIdentityMarkdown(identityMd);
      return {
        identity,
        soulTemplate: detectSoulTemplate(soulMd),
        soulCustomContent: soulMd,
        identityBaseline: JSON.stringify(identity),
        soulBaseline: soulMd,
      };
    },
    [agentId],
    { enabled: enabled && Boolean(agentId), initial: null, errorData: null },
  );

  const loaded = loadedResource.data;
  const profileMarkdownLoading = loadedResource.loading;

  const dirtyRef = useRef(false);
  const [localDraft, setLocalDraft] = useState<OverviewProfileDraft | null>(null);

  const agentKey = agentId ?? '';
  const trackedAgentRef = useRef(agentKey);
  if (trackedAgentRef.current !== agentKey) {
    trackedAgentRef.current = agentKey;
    dirtyRef.current = false;
    setLocalDraft(null);
  }

  const draft = localDraft ?? (loaded ? draftFromLoaded(loaded) : null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const dirty = useMemo(() => {
    if (!draft) return false;
    return (
      JSON.stringify(draft.identity) !== draft.identityBaseline ||
      draft.soulCustomContent !== draft.soulBaseline
    );
  }, [draft]);

  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const patchDraft = useCallback((patch: (prev: OverviewProfileDraft) => OverviewProfileDraft) => {
    dirtyRef.current = true;
    setLocalDraft((prev) => {
      const base = prev ?? (loaded ? draftFromLoaded(loaded) : null);
      return base ? patch(base) : null;
    });
  }, [loaded]);

  const updateIdentity = useCallback(
    (identityPatch: Partial<IdentityFields>) => {
      patchDraft((prev) => ({ ...prev, identity: { ...prev.identity, ...identityPatch } }));
    },
    [patchDraft],
  );

  const handleSoulTemplateChange = useCallback(
    (templateId: SoulTemplateId) => {
      patchDraft((prev) => {
        if (templateId === 'custom') {
          return { ...prev, soulTemplate: 'custom' };
        }
        const tpl = SOUL_TEMPLATES.find((t) => t.id === templateId);
        if (!tpl?.content) {
          return { ...prev, soulTemplate: templateId };
        }
        return {
          ...prev,
          soulTemplate: templateId,
          soulCustomContent: tpl.content,
          soulEditorNonce: prev.soulEditorNonce + 1,
        };
      });
    },
    [patchDraft],
  );

  const handleSoulContentChange = useCallback(
    (content: string) => {
      patchDraft((prev) => ({
        ...prev,
        soulCustomContent: content,
        soulTemplate: 'custom',
      }));
    },
    [patchDraft],
  );

  const setAvatarDialogOpen = useCallback(
    (open: boolean) => {
      patchDraft((prev) => ({ ...prev, avatarDialogOpen: open }));
    },
    [patchDraft],
  );

  const toggleSoulPreviewMode = useCallback(() => {
    patchDraft((prev) => ({ ...prev, soulPreviewMode: !prev.soulPreviewMode }));
  }, [patchDraft]);

  const saveProfileMarkdown = useCallback(async (snapshot?: OverviewProfileDraft) => {
    const id = agentIdRef.current;
    const savingDraft = snapshot ?? draftRef.current;
    if (!id || !savingDraft) return;
    await Promise.all([
      saveAgentProfileFileContent(id, 'IDENTITY.md', serializeIdentityMarkdown(savingDraft.identity)),
      saveAgentProfileFileContent(id, 'SOUL.md', savingDraft.soulCustomContent),
    ]);
    setLocalDraft((prev) => {
      const current = prev ?? savingDraft;
      dirtyRef.current =
        JSON.stringify(current.identity) !== JSON.stringify(savingDraft.identity) ||
        current.soulCustomContent !== savingDraft.soulCustomContent;
      return {
        ...current,
        identityBaseline: JSON.stringify(savingDraft.identity),
        soulBaseline: savingDraft.soulCustomContent,
      };
    });
  }, []);

  const autosave = useAutosave({
    value: draft,
    dirty,
    enabled,
    onSave: saveProfileMarkdown,
  });

  useLayoutEffect(() => {
    if (!saveRef) return;
    saveRef.current = saveProfileMarkdown;
    return () => {
      saveRef.current = null;
    };
  }, [saveProfileMarkdown, saveRef]);

  return {
    profileMarkdownLoading,
    draft,
    dirty,
    autosave,
    updateIdentity,
    handleSoulTemplateChange,
    handleSoulContentChange,
    setAvatarDialogOpen,
    toggleSoulPreviewMode,
  };
}
