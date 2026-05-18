import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type ChatAgentOption } from '@/features/chat/chat-agents-api';
import {
  cronJobBodyText,
  getSessionChatIds,
  type ChannelStatus,
  type CronJob,
  type SessionChatId,
} from '@/features/cron/cron-api';
import { DEFAULT_SCHEDULE, pushRecentWorkspaceDirForCron } from '@/features/cron/cron-page-lib';
import { getCronTemplateCopy } from '@/features/cron/cron-template-i18n';
import { cronTemplateById } from '@/features/cron/cron-templates';
import type { messages as makeMessages } from '@/i18n/messages';

export type FormMode = 'add' | 'edit';
export type FormSessionTarget = 'main' | 'isolated';
export type FormMessageMdMode = 'edit' | 'preview';

export function useCronJobForm(opts: {
  m: ReturnType<typeof makeMessages>;
  defaultModelForForm: () => string;
  channels: ChannelStatus[];
  chatAgents: ChatAgentOption[];
}) {
  const { m, defaultModelForForm, channels, chatAgents } = opts;

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('add');
  const [formJobId, setFormJobId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formSchedule, setFormSchedule] = useState(DEFAULT_SCHEDULE);
  const [formChannel, setFormChannel] = useState('local');
  const [formChatId, setFormChatId] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formMessageMdMode, setFormMessageMdMode] = useState<FormMessageMdMode>('edit');
  const [messageEditorNonce, setMessageEditorNonce] = useState(0);
  const [formSessionTarget, setFormSessionTarget] = useState<FormSessionTarget>('main');
  const [formAgentId, setFormAgentId] = useState('');
  const [formAgentLocalOnly, setFormAgentLocalOnly] = useState(false);
  const [formWorkingDirectory, setFormWorkingDirectory] = useState('');
  const [formWdModalOpen, setFormWdModalOpen] = useState(false);
  const [formModel, setFormModel] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [sessionChatIds, setSessionChatIds] = useState<SessionChatId[]>([]);
  const formModelUserTouched = useRef(false);

  const cronAgentSelectOptions = useMemo(() => {
    const ids = new Set(chatAgents.map((a) => a.id));
    const out: ChatAgentOption[] = [...chatAgents];
    const extra = formAgentId.trim().toLowerCase();
    if (extra && !ids.has(extra)) {
      out.push({ id: extra });
    }
    return out;
  }, [chatAgents, formAgentId]);

  const needsDeliveryChat =
    formChannel !== 'local' && (formSessionTarget === 'main' || (formSessionTarget === 'isolated' && !formAgentLocalOnly));

  const showChannelPicker =
    formSessionTarget === 'main' || (formSessionTarget === 'isolated' && !formAgentLocalOnly);

  const canSubmit =
    Boolean(formName.trim()) &&
    Boolean(formSchedule.trim()) &&
    Boolean(formMessage.trim()) &&
    (!needsDeliveryChat || Boolean(formChatId.trim()));

  useEffect(() => {
    if (!formOpen || formMode !== 'add' || formModelUserTouched.current) return;
    const next = defaultModelForForm();
    if (next) setFormModel(next);
  }, [formOpen, formMode, defaultModelForForm]);

  useEffect(() => {
    if (!formOpen || formMode !== 'add') return;
    const valid = new Set(['local', ...channels.map((x) => x.name)]);
    if (!valid.has(formChannel)) setFormChannel('local');
  }, [channels, formChannel, formMode, formOpen]);

  useEffect(() => {
    if (formChannel === 'local') {
      setSessionChatIds([]);
      return;
    }
    let cancelled = false;
    void getSessionChatIds(formChannel).then((ids) => {
      if (!cancelled) setSessionChatIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [formChannel, formOpen]);

  const openForm = useCallback(
    (job?: CronJob) => {
      formModelUserTouched.current = false;
      setFormOpen(true);
      setFormMode(job ? 'edit' : 'add');
      setFormJobId(job?.id ?? null);

      if (job) {
        setFormName(job.name || '');
        setFormSchedule((job.schedule && String(job.schedule).trim()) || DEFAULT_SCHEDULE);
        const bodyText = cronJobBodyText(job);
        setFormMessage(bodyText ?? '');
        setFormSessionTarget(job.sessionTarget || 'main');
        setFormAgentId(
          (job.sessionTarget || 'main') === 'isolated' && job.agentId?.trim()
            ? job.agentId.trim().toLowerCase()
            : '',
        );
        setFormWorkingDirectory(
          (job.sessionTarget || 'main') === 'isolated' && job.workingDirectory?.trim()
            ? job.workingDirectory.trim()
            : '',
        );
        const fromPayload =
          job.payload?.kind === 'agentTurn' && job.payload.model?.trim() ? job.payload.model.trim() : '';
        const stored = job.model?.trim() || fromPayload;
        setFormModel(stored || defaultModelForForm());
        const hasLocalChannel = job.delivery?.channel === 'local';
        const agentLocalOnly =
          (job.sessionTarget || 'main') === 'isolated' &&
          !hasLocalChannel &&
          (!job.delivery?.to || job.delivery.mode === 'none');
        setFormAgentLocalOnly(agentLocalOnly);

        if (hasLocalChannel) {
          setFormChannel('local');
          setFormChatId('');
        } else if (job.delivery && job.delivery.mode !== 'none' && job.delivery.to) {
          setFormChannel(job.delivery.channel || 'telegram');
          setFormChatId(job.delivery.to || '');
        } else if (!agentLocalOnly) {
          const parts = bodyText.split(':');
          const knownChannels = ['telegram', 'cli', 'gateway', 'local'];
          if (parts.length >= 3 && knownChannels.includes(parts[0])) {
            setFormChannel(parts[0]);
            setFormChatId(parts[1]);
            setFormMessage(parts.slice(2).join(':'));
          } else {
            setFormChannel('telegram');
            setFormChatId('');
          }
        } else {
          setFormChannel('telegram');
          setFormChatId('');
        }
      } else {
        setFormName('');
        setFormSchedule(DEFAULT_SCHEDULE);
        setFormChannel('local');
        setFormChatId('');
        setFormMessage('');
        setFormSessionTarget('main');
        setFormAgentId('');
        setFormWorkingDirectory('');
        setFormAgentLocalOnly(false);
        setFormModel(defaultModelForForm());
      }
      setFormMessageMdMode('edit');
      setMessageEditorNonce((n) => n + 1);
    },
    [defaultModelForForm],
  );

  const setMessageMdMode = useCallback((mode: FormMessageMdMode) => {
    setFormMessageMdMode(mode);
    if (mode === 'edit') setMessageEditorNonce((n) => n + 1);
  }, []);

  const applyCronTemplate = useCallback(
    (templateId: string): boolean => {
      const def = cronTemplateById(templateId);
      const copy = def ? getCronTemplateCopy(m.cron, templateId) : undefined;
      if (!def || !copy) return false;
      formModelUserTouched.current = false;
      setFormMode('add');
      setFormJobId(null);
      setFormName(copy.title);
      setFormSchedule(def.defaultSchedule);
      setFormMessage(copy.prompt);
      setFormSessionTarget(def.defaultSessionTarget);
      setFormChannel('local');
      setFormChatId('');
      setFormAgentLocalOnly(false);
      setFormAgentId('');
      setFormWorkingDirectory('');
      setFormModel(defaultModelForForm());
      setFormMessageMdMode('edit');
      setMessageEditorNonce((n) => n + 1);
      setFormOpen(true);
      return true;
    },
    [defaultModelForForm, m.cron],
  );

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setFormMode('add');
    setFormJobId(null);
    setFormName('');
    setFormSchedule(DEFAULT_SCHEDULE);
    setFormChannel('local');
    setFormChatId('');
    setFormMessage('');
    setFormSessionTarget('main');
    setFormAgentId('');
    setFormWorkingDirectory('');
    setFormWdModalOpen(false);
    setFormAgentLocalOnly(false);
    setFormModel('');
    setFormMessageMdMode('edit');
    formModelUserTouched.current = false;
  }, []);

  const handleFormSessionTargetChange = useCallback(
    (target: FormSessionTarget, defaultModelFallback: () => string, currentModel: string) => {
      setFormSessionTarget(target);
      if (target === 'main') {
        setFormAgentLocalOnly(false);
        setFormAgentId('');
        setFormWorkingDirectory('');
      } else if (target === 'isolated' && !currentModel) setFormModel(defaultModelFallback());
    },
    [],
  );

  const handleFormChannelChange = useCallback((v: string) => {
    setFormChannel(v);
    if (v === 'local') setFormAgentLocalOnly(false);
    setFormChatId('');
  }, []);

  const handleFormModelUserChange = useCallback((id: string) => {
    formModelUserTouched.current = true;
    setFormModel(id);
  }, []);

  const refreshRecipientsList = useCallback(() => {
    void getSessionChatIds(formChannel).then(setSessionChatIds);
  }, [formChannel]);

  const applyWorkingDirectory = useCallback(async (path: string) => {
    const t = path.trim();
    if (!t) return;
    pushRecentWorkspaceDirForCron(t);
    setFormWorkingDirectory(t);
  }, []);

  return {
    // state
    formOpen,
    formMode,
    formJobId,
    formName,
    formSchedule,
    formChannel,
    formChatId,
    formMessage,
    formMessageMdMode,
    messageEditorNonce,
    formSessionTarget,
    formAgentId,
    formAgentLocalOnly,
    formWorkingDirectory,
    formWdModalOpen,
    formModel,
    formSubmitting,
    sessionChatIds,
    // setters
    setFormName,
    setFormSchedule,
    setFormChatId,
    setFormMessage,
    setFormAgentId,
    setFormAgentLocalOnly,
    setFormWorkingDirectory,
    setFormWdModalOpen,
    setFormSubmitting,
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
    applyWorkingDirectory,
  };
}
