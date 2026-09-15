import { useRef, useState } from 'react';

import { t } from '../i18n';

/** A full extension page lets Chrome show its microphone permission prompt. */
export function MicrophonePermission() {
  const requesting = useRef(false);
  const [state, setState] = useState<'idle' | 'pending' | 'granted' | 'denied'>('idle');
  async function authorize() {
    if (requesting.current) return;
    requesting.current = true;
    setState('pending');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setState('granted');
    } catch {
      setState('denied');
    } finally {
      requesting.current = false;
    }
  }
  return <main className="microphone-permission">
    <h1>{t('voicePermissionOpen')}</h1>
    <p role="status">{t(state === 'granted' ? 'voicePermissionGranted' : state === 'denied' ? 'voicePermissionFailed' : 'voicePermissionHelp')}</p>
    {state !== 'granted' ? <button type="button" disabled={state === 'pending'} onClick={() => void authorize()}>{t(state === 'pending' ? 'voiceStarting' : 'voicePermissionOpen')}</button> : null}
  </main>;
}
