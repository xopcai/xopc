import { useEffect, useState } from 'react';

import { t } from '../i18n';
import type { BrowserChatAttachment } from './chat-message-model';
import { CameraIcon, FileIcon } from './icons';

function formatFileSize(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageAttachmentChip({
  attachment,
  hasPreview,
  loadPreview,
  onPreview,
}: {
  attachment: BrowserChatAttachment;
  hasPreview: boolean;
  loadPreview?: () => Promise<string | undefined>;
  onPreview: (title: string, image: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string>();

  useEffect(() => {
    if (attachment.type !== 'image' || !hasPreview || !loadPreview) return;
    let active = true;
    void loadPreview().then((url) => {
      if (active && url) setImageUrl(url);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [attachment.type, hasPreview, loadPreview]);

  if (attachment.type === 'image' && imageUrl) {
    return (
      <button
        type="button"
        className="message-image-card"
        aria-label={t('preview')}
        title={attachment.name}
        onClick={() => onPreview(attachment.name, imageUrl)}
      >
        <img src={imageUrl} alt={attachment.name} loading="lazy" />
        <span className="message-image-caption">
          <strong>{attachment.name}</strong>
          {formatFileSize(attachment.size) ? <small>{formatFileSize(attachment.size)}</small> : null}
        </span>
      </button>
    );
  }

  return (
    <span className="message-attachment" title={attachment.mimeType}>
      {attachment.type === 'image' ? <CameraIcon /> : <FileIcon />}
      <span>
        <strong>{attachment.name}</strong>
        {formatFileSize(attachment.size) ? <small>{formatFileSize(attachment.size)}</small> : null}
      </span>
    </span>
  );
}
