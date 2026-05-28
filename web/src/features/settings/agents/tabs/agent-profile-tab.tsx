import { Info, UserCircle } from 'lucide-react';
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from 'react';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import {
  fetchAgentProfileFileContent,
  saveAgentProfileFileContent,
} from '@/features/settings/agents-admin-api';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useAsyncResource } from '@/lib/use-async-resource';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { agentsSettingsInputClass } from '../utils';
import {
  type UserFields,
  parseUserMarkdown,
  serializeUserMarkdown,
  TIMEZONE_OPTIONS,
  PRONOUNS_PRESETS,
  detectBrowserTimezone,
} from '../agent-profile-markdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileTabProps {
  a: AgentsSettingsMessages;
  agentId: string;
  /** Parent writes a save callback into this ref so the modal footer can trigger it. */
  saveRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Called when dirty state changes. */
  onDirtyChange?: (dirty: boolean) => void;
}

type ProfileFormState = {
  user: UserFields;
  showCustomPronouns: boolean;
  showCustomTimezone: boolean;
  customTimezone: string;
  snapshot: string;
};

type ProfileFormAction =
  | { type: 'load'; user: UserFields }
  | { type: 'patch'; patch: Partial<UserFields> }
  | { type: 'setShowCustomPronouns'; value: boolean }
  | { type: 'setShowCustomTimezone'; value: boolean }
  | { type: 'setCustomTimezone'; value: string }
  | { type: 'saved' };

function profileFormFromUser(user: UserFields): Pick<ProfileFormState, 'showCustomPronouns' | 'showCustomTimezone' | 'customTimezone'> {
  const isKnownPronouns = !user.pronouns || PRONOUNS_PRESETS.some((p) => p.value === user.pronouns);
  const isKnownTimezone = TIMEZONE_OPTIONS.some((tz) => tz.value === user.timezone);
  return {
    showCustomPronouns: Boolean(user.pronouns && !isKnownPronouns),
    showCustomTimezone: Boolean(user.timezone && !isKnownTimezone),
    customTimezone: user.timezone && !isKnownTimezone ? user.timezone : '',
  };
}

function profileFormReducer(state: ProfileFormState, action: ProfileFormAction): ProfileFormState {
  switch (action.type) {
    case 'load': {
      const extras = profileFormFromUser(action.user);
      const snapshot = JSON.stringify(action.user);
      return { user: action.user, snapshot, ...extras };
    }
    case 'patch': {
      const user = { ...state.user, ...action.patch };
      return { ...state, user };
    }
    case 'setShowCustomPronouns':
      return { ...state, showCustomPronouns: action.value };
    case 'setShowCustomTimezone':
      return { ...state, showCustomTimezone: action.value };
    case 'setCustomTimezone':
      return { ...state, customTimezone: action.value };
    case 'saved':
      return { ...state, snapshot: JSON.stringify(state.user) };
  }
}

const emptyUser: UserFields = {
  callName: '',
  pronouns: '',
  timezone: '',
  notes: '',
};

const initialProfileForm: ProfileFormState = {
  user: emptyUser,
  showCustomPronouns: false,
  showCustomTimezone: false,
  customTimezone: '',
  snapshot: JSON.stringify(emptyUser),
};

// ---------------------------------------------------------------------------
// Component — About You (USER.md)
// ---------------------------------------------------------------------------

function AgentProfileTabBody({ a, agentId, saveRef, onDirtyChange }: ProfileTabProps) {
  const language = useLocaleStore((s) => s.language);
  const [form, dispatchForm] = useReducer(profileFormReducer, initialProfileForm);
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const userResource = useAsyncResource(
    async () => {
      const userMd = await fetchAgentProfileFileContent(agentId, 'USER.md').catch(() => '');
      const parsedUser = parseUserMarkdown(userMd);
      if (!parsedUser.timezone) {
        const detected = detectBrowserTimezone();
        if (detected) {
          return { ...parsedUser, timezone: detected };
        }
      }
      return parsedUser;
    },
    [agentId],
    { enabled: Boolean(agentId), initial: null as UserFields | null, errorData: emptyUser },
  );

  const syncedAgentRef = useRef<string | null>(null);
  useEffect(() => {
    if (userResource.loading || !userResource.data) return;
    if (syncedAgentRef.current === agentId) return;
    syncedAgentRef.current = agentId;
    dispatchForm({ type: 'load', user: userResource.data });
    onDirtyChangeRef.current?.(false);
  }, [agentId, userResource.loading, userResource.data]);

  const saveFile = useCallback(async (content: string) => {
    await saveAgentProfileFileContent(agentIdRef.current, 'USER.md', content);
  }, []);

  const userRef = useRef(form.user);
  userRef.current = form.user;

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = async () => {
      await saveFile(serializeUserMarkdown(userRef.current));
      dispatchForm({ type: 'saved' });
      onDirtyChangeRef.current?.(false);
    };
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, saveFile]);

  const updateUser = useCallback((patch: Partial<UserFields>) => {
    dispatchForm({ type: 'patch', patch });
    const next = { ...userRef.current, ...patch };
    onDirtyChangeRef.current?.(JSON.stringify(next) !== form.snapshot);
  }, [form.snapshot]);

  const handleTimezoneChange = useCallback(
    (value: string) => {
      if (value === '__custom__') {
        dispatchForm({ type: 'setShowCustomTimezone', value: true });
        return;
      }
      dispatchForm({ type: 'setShowCustomTimezone', value: false });
      dispatchForm({ type: 'setCustomTimezone', value: '' });
      updateUser({ timezone: value });
    },
    [updateUser],
  );

  const handleCustomTimezoneChange = useCallback(
    (value: string) => {
      dispatchForm({ type: 'setCustomTimezone', value });
      updateUser({ timezone: value });
    },
    [updateUser],
  );

  const handleDetectTimezone = useCallback(() => {
    const detected = detectBrowserTimezone();
    if (!detected) return;
    const isKnown = TIMEZONE_OPTIONS.some((tz) => tz.value === detected);
    if (isKnown) {
      dispatchForm({ type: 'setShowCustomTimezone', value: false });
      dispatchForm({ type: 'setCustomTimezone', value: '' });
    } else {
      dispatchForm({ type: 'setShowCustomTimezone', value: true });
      dispatchForm({ type: 'setCustomTimezone', value: detected });
    }
    updateUser({ timezone: detected });
  }, [updateUser]);

  const timezoneSelectValue = (() => {
    if (form.showCustomTimezone) return '__custom__';
    const isKnown = TIMEZONE_OPTIONS.some((tz) => tz.value === form.user.timezone);
    return isKnown ? form.user.timezone : '__custom__';
  })();

  const locLabel = useCallback(
    (en: string, zh: string) => (language === 'zh' ? zh : en),
    [language],
  );

  if (userResource.loading) {
    return <p className="text-sm text-fg-muted">{a.loading}</p>;
  }

  const inputClass = agentsSettingsInputClass();
  const { user, showCustomPronouns, showCustomTimezone, customTimezone } = form;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <p className="text-sm text-fg-muted">{a.personaSectionUserHint}</p>

      <SettingsFormSection>
        <SettingsFormSectionHeader
          icon={UserCircle}
          title={a.personaSectionUser}
          subtitle={a.personaSectionUserHint}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Call name */}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.personaCallName}</span>
            <input
              className={inputClass}
              value={user.callName}
              onChange={(e) => updateUser({ callName: e.target.value })}
              placeholder={a.personaCallNamePlaceholder}
              autoComplete="off"
            />
          </label>

          {/* Pronouns */}
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">{a.personaPronouns}</span>
            <select
              className={inputClass}
              value={PRONOUNS_PRESETS.some((p) => p.value === user.pronouns) ? user.pronouns : '__custom__'}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  dispatchForm({ type: 'setShowCustomPronouns', value: true });
                  return;
                }
                dispatchForm({ type: 'setShowCustomPronouns', value: false });
                updateUser({ pronouns: e.target.value });
              }}
            >
              <option value="" disabled>
                {a.personaPronounsPlaceholder}
              </option>
              {PRONOUNS_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {locLabel(preset.labelEn, preset.labelZh)}
                </option>
              ))}
              <option value="__custom__">{locLabel('Custom…', '自定义…')}</option>
            </select>
            {showCustomPronouns ? (
              <input
                className={cn(inputClass, 'mt-1 text-xs')}
                value={PRONOUNS_PRESETS.some((p) => p.value === user.pronouns) ? '' : user.pronouns}
                onChange={(e) => updateUser({ pronouns: e.target.value })}
                placeholder={a.personaPronounsPlaceholder}
                autoComplete="off"
              />
            ) : null}
          </div>

          {/* Timezone */}
          <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.personaTimezone}</span>
            <div className="flex flex-wrap items-stretch gap-2">
              <select
                className={cn(inputClass, 'min-w-0 flex-1')}
                value={timezoneSelectValue}
                onChange={(e) => handleTimezoneChange(e.target.value)}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {locLabel(tz.labelEn, tz.labelZh)}
                  </option>
                ))}
                <option value="__custom__">{a.personaTimezoneCustom}</option>
              </select>
              <button
                type="button"
                className={cn(
                  'shrink-0 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg',
                  interaction.press,
                )}
                onClick={handleDetectTimezone}
              >
                {a.personaTimezoneDetect}
              </button>
            </div>
            {showCustomTimezone ? (
              <input
                className={cn(inputClass, 'mt-1 font-mono text-xs')}
                value={customTimezone}
                onChange={(e) => handleCustomTimezoneChange(e.target.value)}
                placeholder="e.g. Asia/Shanghai"
                autoComplete="off"
              />
            ) : null}
          </div>

          {/* Notes */}
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium text-fg">{a.personaNotes}</span>
            <textarea
              className={cn(inputClass, 'min-h-16 resize-y text-sm leading-relaxed')}
              value={user.notes}
              onChange={(e) => updateUser({ notes: e.target.value })}
              placeholder={a.personaNotesPlaceholder}
              rows={3}
              spellCheck
            />
          </label>
        </div>

        {/* Memory note */}
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-accent-soft/30 px-3 py-2.5 text-xs text-fg-muted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
          <span>{a.personaMemoryNote}</span>
        </div>
      </SettingsFormSection>
    </div>
  );
}

export function AgentProfileTab(props: ProfileTabProps) {
  return <AgentProfileTabBody key={props.agentId} {...props} />;
}
