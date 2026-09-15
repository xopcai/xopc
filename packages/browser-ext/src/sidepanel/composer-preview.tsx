import { useEffect, useRef } from 'react';
import { t } from '../i18n';

export type ComposerPreview = { title: string; image?: string; text?: string };
export function ComposerPreviewDialog({ preview, onClose }: { preview: ComposerPreview; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="composer-preview" aria-label={preview.title} onClose={onClose}>
    <header><strong>{preview.title}</strong><button type="button" onClick={() => dialog.current?.close()}>{t('closePreview')}</button></header>
    <div className="composer-preview-body">{preview.image ? <img src={preview.image} alt={preview.title} /> : <pre>{preview.text}</pre>}</div>
  </dialog>;
}
