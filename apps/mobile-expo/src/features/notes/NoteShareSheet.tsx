import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { createNoteShare, type Note, type NoteShareLink } from '../../query/notes';
import { queryKeys } from '../../query/keys';
import { useRevokeShare } from '../../query/shares';
import { spacing, useTheme } from '../../theme';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';

export function NoteShareSheet({ note, onDismiss }: { note: Note; onDismiss: () => void }) {
  const pm = useMessages().notesPage;
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [link, setLink] = useState<NoteShareLink | null>(null);
  const [feedback, setFeedback] = useState('');
  const create = useMutation({
    mutationFn: () => createNoteShare(note),
    onSuccess: (result) => {
      setLink(result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares });
    },
  });
  const revoke = useRevokeShare();
  const action = useMutation({
    mutationFn: async (kind: 'copy' | 'share' | 'revoke') => {
      if (!link) return;
      setFeedback('');
      if (kind === 'revoke') {
        await revoke.mutateAsync(link.id);
        setLink(null);
        setFeedback(pm.shareLinkRevoked);
      } else if (kind === 'copy') {
        await setAppClipboardStringAsync(link.shareUrl);
        setFeedback(pm.shareLinkCopied);
      } else {
        await Share.share(Platform.OS === 'ios'
          ? { url: link.shareUrl, title: note.title || pm.shareNotesTitle }
          : { message: link.shareUrl, title: note.title || pm.shareNotesTitle });
      }
    },
  });
  const busy = create.isPending || action.isPending;
  const error = create.error || action.error;
  return <BottomSheetModal visible onDismiss={onDismiss} scroll title={pm.shareNotesTitle} maxHeight="70%">
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <Text variant="titleMedium">{note.title || pm.untitledNote}</Text>
      <Text style={{ color: colors.text.secondary }}>{pm.shareLinkDescription}</Text>
      {link ? <>
        <Text selectable style={{ color: colors.accent.primary }}>{link.shareUrl}</Text>
        <Text style={{ color: colors.text.secondary }}>{new Date(link.expiresAt).toLocaleString()}</Text>
        {link.reachabilityHint ? <Text style={{ color: colors.text.secondary }}>{link.reachabilityHint}</Text> : null}
        <Button mode="contained" disabled={busy} loading={action.isPending && action.variables === 'share'} onPress={() => action.mutate('share')}>{pm.viewShare}</Button>
        <Button disabled={busy} onPress={() => action.mutate('copy')}>{pm.copyShareLink}</Button>
        <Button textColor={colors.semantic.error} disabled={busy} onPress={() => action.mutate('revoke')}>{pm.revokeShareLink}</Button>
      </> : <Button mode="contained" disabled={busy} loading={create.isPending} onPress={() => { setFeedback(''); create.mutate(); }}>{pm.createShareLink}</Button>}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.semantic.error }}>{error.message}</Text> : null}
      {feedback ? <Text accessibilityLiveRegion="polite">{feedback}</Text> : null}
    </View>
  </BottomSheetModal>;
}
