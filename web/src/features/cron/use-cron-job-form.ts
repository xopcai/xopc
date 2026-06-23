import { useCallback, useMemo, useReducer, useRef } from 'react';

import { type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import {
  cronJobBodyText,
  cronExpressionToSchedule,
  getSessionChatIds,
  type ChannelStatus,
  type CronJob,
  type CronSchedule,
  type SessionChatId,
} from '@/features/cron/cron-api';
import { DEFAULT_SCHEDULE } from '@/features/cron/cron-page-lib';
import { getCronTemplateCopy } from '@/features/cron/cron-template-i18n';
import { cronTemplateById } from '@/features/cron/cron-templates';
import { validateWorkflowArgValues, workflowInputToArgValues } from '@/features/workflows/workflow-input.utils';
import type { messages as makeMessages } from '@/i18n/messages';
import { useAsyncResource } from '@/lib/use-async-resource';

export type FormMode = 'add' | 'edit';
export type FormSessionTarget = 'main' | 'isolated';
export type FormMessageMdMode = 'edit' | 'preview';
export type FormTaskKind = 'message' | 'workflowRun';

type FormState = {
  formOpen: boolean;
  formMode: FormMode;
  formJobId: string | null;
  formName: string;
  formSchedule: CronSchedule;
  formChannel: string;
  formChatId: string;
  formMessage: string;
  formMessageMdMode: FormMessageMdMode;
  formTaskKind: FormTaskKind;
  formWorkflowDefinitionId: string;
  formWorkflowGoal: string;
  formWorkflowArgValues: Record<string, string>;
  messageEditorNonce: number;
  formSessionTarget: FormSessionTarget;
  formAgentId: string;
  formAgentLocalOnly: boolean;
  formWorkingDirectory: string;
  formModel: string;
  formSubmitting: boolean;
};

type FormAction =
  | { type: 'patch'; patch: Partial<FormState> }
  | { type: 'replace'; state: FormState }
  | { type: 'setMessageMdMode'; mode: FormMessageMdMode };

function initialFormState(): FormState {
  return {
    formOpen: false,
    formMode: 'add',
    formJobId: null,
    formName: '',
    formSchedule: cronExpressionToSchedule(DEFAULT_SCHEDULE),
    formChannel: 'local',
    formChatId: '',
    formMessage: '',
    formMessageMdMode: 'edit',
    formTaskKind: 'message',
    formWorkflowDefinitionId: '',
    formWorkflowGoal: '',
    formWorkflowArgValues: {},
    messageEditorNonce: 0,
    formSessionTarget: 'main',
    formAgentId: '',
    formAgentLocalOnly: false,
    formWorkingDirectory: '',
    formModel: '',
    formSubmitting: false,
  };
}

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'replace':
      return action.state;
    case 'setMessageMdMode':
      return {
        ...state,
        formMessageMdMode: action.mode,
        messageEditorNonce: action.mode === 'edit' ? state.messageEditorNonce + 1 : state.messageEditorNonce,
      };
  }
}

function buildOpenFormState(job: CronJob | undefined, defaultModelForForm: () => string): FormState {
  const base = initialFormState();
  base.formOpen = true;
  base.formMode = job ? 'edit' : 'add';
  base.formJobId = job?.id ?? null;

  if (!job) {
    base.formModel = defaultModelForForm();
    return base;
  }

  base.formName = job.name || '';
  base.formSchedule = job.schedule;
  const bodyText = cronJobBodyText(job);
  base.formMessage = bodyText ?? '';
  if (job.payload.kind === 'workflowRun') {
    base.formTaskKind = 'workflowRun';
    base.formWorkflowDefinitionId = job.payload.definitionId;
    base.formWorkflowGoal = job.payload.goal || '';
    base.formWorkflowArgValues = workflowInputToArgValues(
      job.payload.definitionId,
      job.payload.inputEnvelope?.payload ?? job.payload.input ?? {},
    );
    const payloadAgentId = job.payload.agentId?.trim().toLowerCase();
    if (payloadAgentId) {
      base.formAgentId = payloadAgentId;
    }
  }
  base.formSessionTarget = job.sessionTarget === 'isolated' ? 'isolated' : 'main';
  base.formAgentId =
    (job.sessionTarget || 'main') === 'isolated' && job.agentId?.trim()
      ? job.agentId.trim().toLowerCase()
      : '';
  base.formWorkingDirectory =
    (job.sessionTarget || 'main') === 'isolated' && job.workingDirectory?.trim()
      ? job.workingDirectory.trim()
      : '';
  const fromPayload =
    job.payload?.kind === 'agentTurn' && job.payload.model?.trim() ? job.payload.model.trim() : '';
  const stored = job.model?.trim() || fromPayload;
  base.formModel = stored || defaultModelForForm();
  const hasLocalChannel = job.delivery?.channel === 'local';
  const agentLocalOnly =
    (job.sessionTarget || 'main') === 'isolated' &&
    !hasLocalChannel &&
    (!job.delivery?.to || job.delivery.mode === 'none');
  base.formAgentLocalOnly = agentLocalOnly;

  if (hasLocalChannel) {
    base.formChannel = 'local';
    base.formChatId = '';
  } else if (job.delivery && job.delivery.mode !== 'none' && job.delivery.to) {
    base.formChannel = job.delivery.channel || 'telegram';
    base.formChatId = job.delivery.to || '';
  } else if (!agentLocalOnly) {
    base.formChannel = 'telegram';
    base.formChatId = '';
  } else {
    base.formChannel = 'telegram';
    base.formChatId = '';
  }

  base.formMessageMdMode = 'edit';
  base.messageEditorNonce = 1;
  return base;
}

export function useCronJobForm(opts: {
  m: ReturnType<typeof makeMessages>;
  defaultModelForForm: () => string;
  channels: ChannelStatus[];
  chatAgents: ChatAgentOption[];
}) {
  const { m, defaultModelForForm, channels, chatAgents } = opts;

  const [form, dispatch] = useReducer(formReducer, undefined as never, initialFormState);
  const formModelUserTouched = useRef(false);

  const validChannelSet = useMemo(
    () => new Set(['local', ...channels.map((x) => x.name)]),
    [channels],
  );

  if (form.formOpen && form.formMode === 'add' && !validChannelSet.has(form.formChannel)) {
    dispatch({ type: 'patch', patch: { formChannel: 'local' } });
  }

  if (form.formOpen && form.formMode === 'add' && !formModelUserTouched.current) {
    const next = defaultModelForForm();
    if (next && next !== form.formModel) {
      dispatch({ type: 'patch', patch: { formModel: next } });
    }
  }

  const sessionChatIdsResource = useAsyncResource(
    () => getSessionChatIds(form.formChannel),
    [form.formChannel],
    {
      enabled: form.formOpen && form.formChannel !== 'local',
      initial: [] as SessionChatId[],
      errorData: [] as SessionChatId[],
    },
  );
  const sessionChatIds = form.formChannel === 'local' ? [] : sessionChatIdsResource.data;

  const cronAgentSelectOptions = useMemo(() => {
    const ids = new Set(chatAgents.map((a) => a.id));
    const out: ChatAgentOption[] = [...chatAgents];
    const extra = form.formAgentId.trim().toLowerCase();
    if (extra && !ids.has(extra)) {
      out.push({ id: extra });
    }
    return out;
  }, [chatAgents, form.formAgentId]);

  const needsDeliveryChat =
    form.formChannel !== 'local' &&
    ((form.formTaskKind === 'message' &&
      (form.formSessionTarget === 'main' || (form.formSessionTarget === 'isolated' && !form.formAgentLocalOnly))) ||
      (form.formTaskKind === 'workflowRun' && !form.formAgentLocalOnly));

  const showChannelPicker =
    form.formTaskKind === 'workflowRun'
      ? !form.formAgentLocalOnly
      : form.formTaskKind === 'message' &&
        (form.formSessionTarget === 'main' || (form.formSessionTarget === 'isolated' && !form.formAgentLocalOnly));

  const hasRunnablePayload = form.formTaskKind === 'workflowRun'
    ? Boolean(form.formWorkflowDefinitionId.trim()) &&
      validateWorkflowArgValues(form.formWorkflowDefinitionId.trim(), form.formWorkflowArgValues)
    : Boolean(form.formMessage.trim());

  const hasSchedule =
    form.formSchedule.kind === 'cron'
      ? Boolean(form.formSchedule.expr.trim())
      : form.formSchedule.kind === 'at'
        ? Boolean(form.formSchedule.at.trim())
        : Number.isFinite(form.formSchedule.everyMs) && form.formSchedule.everyMs > 0;

  const canSubmit =
    Boolean(form.formName.trim()) &&
    hasSchedule &&
    hasRunnablePayload &&
    (!needsDeliveryChat || Boolean(form.formChatId.trim()));

  const openForm = useCallback(
    (job?: CronJob) => {
      formModelUserTouched.current = false;
      dispatch({ type: 'replace', state: buildOpenFormState(job, defaultModelForForm) });
    },
    [defaultModelForForm],
  );

  const setMessageMdMode = useCallback((mode: FormMessageMdMode) => {
    dispatch({ type: 'setMessageMdMode', mode });
  }, []);

  const applyCronTemplate = useCallback(
    (templateId: string): boolean => {
      const def = cronTemplateById(templateId);
      const copy = def ? getCronTemplateCopy(m.cron, templateId) : undefined;
      if (!def || !copy) return false;
      const isWorkflowTemplate = def.taskKind === 'workflowRun' && Boolean(def.workflowDefinitionId);
      formModelUserTouched.current = false;
      dispatch({
        type: 'replace',
        state: {
          ...initialFormState(),
          formOpen: true,
          formMode: 'add',
          formName: copy.title,
          formSchedule: cronExpressionToSchedule(def.defaultSchedule),
          formMessage: isWorkflowTemplate ? '' : copy.prompt,
          formTaskKind: isWorkflowTemplate ? 'workflowRun' : 'message',
          formWorkflowDefinitionId: isWorkflowTemplate ? def.workflowDefinitionId! : '',
          formWorkflowGoal: isWorkflowTemplate ? copy.description : '',
          formSessionTarget: def.defaultSessionTarget,
          formModel: defaultModelForForm(),
          formAgentLocalOnly: isWorkflowTemplate,
          messageEditorNonce: 1,
        },
      });
      return true;
    },
    [defaultModelForForm, m.cron],
  );

  const closeForm = useCallback(() => {
    formModelUserTouched.current = false;
    dispatch({ type: 'replace', state: initialFormState() });
  }, []);

  const handleFormSessionTargetChange = useCallback(
    (target: FormSessionTarget, defaultModelFallback: () => string, currentModel: string) => {
      const patch: Partial<FormState> = { formSessionTarget: target };
      if (target === 'main') {
        patch.formAgentLocalOnly = false;
        patch.formAgentId = '';
        patch.formWorkingDirectory = '';
      } else if (target === 'isolated' && !currentModel) {
        patch.formModel = defaultModelFallback();
      }
      dispatch({ type: 'patch', patch });
    },
    [],
  );

  const handleFormChannelChange = useCallback((v: string) => {
    dispatch({
      type: 'patch',
      patch: {
        formChannel: v,
        formChatId: '',
        ...(v === 'local' ? { formAgentLocalOnly: false } : {}),
      },
    });
  }, []);

  const handleFormModelUserChange = useCallback((id: string) => {
    formModelUserTouched.current = true;
    dispatch({ type: 'patch', patch: { formModel: id } });
  }, []);

  const refreshRecipientsList = useCallback(() => {
    void getSessionChatIds(form.formChannel).then(sessionChatIdsResource.setData);
  }, [form.formChannel, sessionChatIdsResource.setData]);

  const patchForm = useCallback((patch: Partial<FormState>) => {
    dispatch({ type: 'patch', patch });
  }, []);

  return {
    // state
    formOpen: form.formOpen,
    formMode: form.formMode,
    formJobId: form.formJobId,
    formName: form.formName,
    formSchedule: form.formSchedule,
    formChannel: form.formChannel,
    formChatId: form.formChatId,
    formMessage: form.formMessage,
    formMessageMdMode: form.formMessageMdMode,
    formTaskKind: form.formTaskKind,
    formWorkflowDefinitionId: form.formWorkflowDefinitionId,
    formWorkflowGoal: form.formWorkflowGoal,
    formWorkflowArgValues: form.formWorkflowArgValues,
    messageEditorNonce: form.messageEditorNonce,
    formSessionTarget: form.formSessionTarget,
    formAgentId: form.formAgentId,
    formAgentLocalOnly: form.formAgentLocalOnly,
    formWorkingDirectory: form.formWorkingDirectory,
    formModel: form.formModel,
    formSubmitting: form.formSubmitting,
    sessionChatIds,
    // setters
    setFormName: (formName: string) => patchForm({ formName }),
    setFormSchedule: (formSchedule: CronSchedule) => patchForm({ formSchedule }),
    setFormChatId: (formChatId: string) => patchForm({ formChatId }),
    setFormMessage: (formMessage: string) => patchForm({ formMessage }),
    setFormTaskKind: (formTaskKind: FormTaskKind) =>
      patchForm(
        formTaskKind === 'workflowRun'
          ? { formTaskKind, formSessionTarget: 'isolated', formAgentLocalOnly: false }
          : { formTaskKind },
      ),
    setFormWorkflowDefinitionId: (formWorkflowDefinitionId: string) =>
      patchForm({ formWorkflowDefinitionId, formWorkflowArgValues: {} }),
    setFormWorkflowGoal: (formWorkflowGoal: string) => patchForm({ formWorkflowGoal }),
    setFormWorkflowArgValues: (formWorkflowArgValues: Record<string, string>) =>
      patchForm({ formWorkflowArgValues }),
    setFormAgentId: (formAgentId: string) => patchForm({ formAgentId }),
    setFormAgentLocalOnly: (formAgentLocalOnly: boolean) => patchForm({ formAgentLocalOnly }),
    setFormWorkingDirectory: (formWorkingDirectory: string) => patchForm({ formWorkingDirectory }),
    setFormSubmitting: (formSubmitting: boolean) => patchForm({ formSubmitting }),
    // derived
    canSubmit,
    needsDeliveryChat,
    showChannelPicker,
    cronAgentSelectOptions,
    // handlers
    openForm,
    closeForm,
    applyCronTemplate,
    setMessageMdMode,
    handleFormSessionTargetChange,
    handleFormChannelChange,
    handleFormModelUserChange,
    refreshRecipientsList,
  };
}
