import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { useMessages } from '../../i18n/messages';
import { mobileRouteForWorkbenchHref } from '../../lib/workbench-route';
import {
  acknowledgeHomeAttention,
  respondToHomeDecision,
  retryHomeAttention,
  type HomeAction,
} from '../../query/home';
import { queryKeys } from '../../query/keys';

type RemoteAttentionAction = Exclude<HomeAction, { type: 'open' | 'review_judgment' }>;

export function useAttentionActions() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const m = useMessages();
  const [feedback, setFeedback] = useState('');

  const mutation = useMutation({
    mutationFn: async (action: RemoteAttentionAction) => {
      if (action.type === 'connector_decision') {
        return respondToHomeDecision(
          { kind: 'connector_approval', approvalId: action.approvalId },
          action.decision,
        );
      }
      const item = { kind: action.subjectKind, runId: action.runId };
      if (action.type === 'retry_run') return retryHomeAttention(item);
      return acknowledgeHomeAttention(item);
    },
    onSuccess: (_result, action) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      setFeedback(
        action.type === 'connector_decision'
          ? m.homePage.decisionCompleted
          : action.type === 'retry_run'
            ? m.homePage.attentionRetryStarted
            : m.homePage.attentionAcknowledged,
      );
    },
    onError: (error, action) => {
      setFeedback(
        error instanceof Error
          ? error.message
          : action.type === 'connector_decision'
            ? m.homePage.decisionFailed
            : m.homePage.attentionActionFailed,
      );
    },
  });

  const runAction = useCallback((action: HomeAction) => {
    if (action.type === 'open') {
      router.push(mobileRouteForWorkbenchHref(action.href) as never);
      return;
    }
    if (action.type === 'review_judgment') {
      router.push({ pathname: '/inbox', params: { item: action.itemId } });
      return;
    }
    mutation.mutate(action);
  }, [mutation, router]);

  return {
    runAction,
    pending: mutation.isPending,
    feedback,
    clearFeedback: () => setFeedback(''),
  };
}
