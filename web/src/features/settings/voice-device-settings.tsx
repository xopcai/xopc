import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { VoiceSettingsMessages } from '@/i18n/messages';
import { useVoicePreferencesStore } from '@/stores/voice-preferences-store';

export function VoiceDeviceSettings({ v }: { v: VoiceSettingsMessages }) {
  const microphoneId = useVoicePreferencesStore((state) => state.microphoneId);
  const setMicrophoneId = useVoicePreferencesStore((state) => state.setMicrophoneId);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then((list) => {
      if (mounted.current) setDevices(list.filter((device) => device.kind === 'audioinput'));
    }).catch(() => {}); };
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { mounted.current = false; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, []);
  const requestDevices = async () => {
    setPending(true);
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const list = await navigator.mediaDevices.enumerateDevices();
      if (mounted.current) setDevices(list.filter((device) => device.kind === 'audioinput'));
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally { if (mounted.current) setPending(false); }
  };
  return <section className="space-y-4 rounded-xl border border-edge p-4">
    <label className="block space-y-2 text-sm"><span>{v.experience.microphone}</span>
      <Select value={microphoneId} onChange={(e) => setMicrophoneId(e.target.value)}>
        <SelectOption value="">{v.experience.systemDevice}</SelectOption>
        {microphoneId && !devices.some((device) => device.deviceId === microphoneId) ? <SelectOption value={microphoneId}>{v.experience.unavailable}</SelectOption> : null}
        {devices.filter((device) => device.deviceId && device.deviceId !== 'default').map((device, i) => <SelectOption key={device.deviceId} value={device.deviceId}>{device.label || `${v.experience.microphone} ${i + 1}`}</SelectOption>)}
      </Select>
    </label>
    <p className="text-xs text-fg-muted">{v.experience.deviceHint}</p>
    <Button variant="secondary" disabled={pending} onClick={() => void requestDevices()}>{v.experience.refreshDevices}</Button>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
  </section>;
}
