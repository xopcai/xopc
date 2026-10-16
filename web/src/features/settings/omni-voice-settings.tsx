import { useLocaleStore } from '@/stores/locale-store';
import type { VoiceSettingsState } from './voice-settings.types';

type OmniSettings = NonNullable<VoiceSettingsState['voice']['realtime']['omni']>;

/** Models and credentials are managed by the enclosing capability editor. */
export function OmniVoiceSettings({ value, onChange }: { value: OmniSettings; onChange: (omni: OmniSettings) => void }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  return <details className="space-y-3 rounded-xl bg-surface-hover/20 p-4">
    <summary className="cursor-pointer text-sm font-medium text-fg">{zh ? '通话指令' : 'Conversation instructions'}</summary>
    <p className="text-xs text-fg-muted">{zh ? '通话会接续当前会话。可在这里调整语气与回答方式。' : 'Calls continue the current conversation. Adjust tone and response style here.'}</p>
    <label className="block space-y-2 text-sm"><span>{zh ? '通话指令' : 'Conversation instructions'}</span><textarea className="w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" rows={3} maxLength={8000} value={value.instructions} onChange={event => onChange({ ...value, instructions: event.target.value })} /></label>
  </details>;
}
