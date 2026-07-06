import { useMemo } from 'react';

import { ContentIntakeModal } from '../content-intake/ContentIntakeModal';
import { useContentIntakeActions } from '../content-intake/use-content-intake-actions';
import { useClipboardIntake } from './use-clipboard-intake';

export type ClipboardIntakeModalProps = {
  enabled: boolean;
};

export function ClipboardIntakeModal({ enabled }: ClipboardIntakeModalProps) {
  const { candidate, markHandled } = useClipboardIntake(enabled);
  const intakeCandidate = useMemo(
    () => candidate ? { text: candidate.text, intent: candidate.intent, source: 'clipboard' as const } : null,
    [candidate],
  );
  const { saving, toast, setToast, saveToNote, exploreInChat } = useContentIntakeActions(markHandled);

  return (
    <ContentIntakeModal
      visible={Boolean(candidate)}
      intent={candidate?.intent ?? null}
      saving={saving}
      toast={toast}
      onSave={() => void saveToNote(intakeCandidate)}
      onExplore={() => exploreInChat(intakeCandidate)}
      onDismiss={markHandled}
      onToastDismiss={() => setToast('')}
    />
  );
}
