import { Download, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

import { parseNoteAttachmentTarget } from '@/features/notes/attachment-ref';
import { acquireNoteMediaObjectUrl, releaseNoteMediaObjectUrl } from '@/features/notes/note-media-blob';
import type { NoteAttachment } from '@/features/notes/notes-api';
import { VoiceNotePlayer } from '@/features/notes/voice-note-player';
import { useLocaleStore } from '@/stores/locale-store';

import type { AudioNodeOptions } from './extensions/audio-node';

const AUDIO_EXT_RE = /\.(mp3|m4a|wav|ogg|webm|aac|flac|opus)$/i;
const FILE_EXT_RE = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|tsv|txt|md|json|yaml|yml|xml|zip|tar|gz|7z|rar|html|js|ts|py|sql)$/i;

export function isLikelyAudioAttachment(attachment: NoteAttachment | undefined, label?: string): boolean {
  if (attachment) {
    return attachment.type === 'audio' || attachment.mimeType.toLowerCase().startsWith('audio/');
  }
  const text = (label ?? '').trim();
  if (!text) return true;
  if (AUDIO_EXT_RE.test(text)) return true;
  if (FILE_EXT_RE.test(text)) return false;
  if (/🎤|🎧|voice|audio|memo|录音|语音|\b\d+:\d{2}\b/i.test(text)) return true;
  return !text.includes('.');
}

function formatSize(bytes?: number): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function AudioBlock({ node, extension }: NodeViewProps) {
  const zh = useLocaleStore((s) => s.language === 'zh');
  const [downloading, setDownloading] = useState(false);
  const { href, label } = node.attrs as { href: string; label?: string };

  const parsed = parseNoteAttachmentTarget(href);
  if (!parsed) {
    return (
      <NodeViewWrapper as="span" className="inline text-sm italic text-fg-muted">
        {zh ? '[附件不可用]' : '[attachment unavailable]'}
      </NodeViewWrapper>
    );
  }

  const options = extension.options as AudioNodeOptions | undefined;
  const knownAttachments = options?.getAttachments?.();
  const matched = knownAttachments?.find((item) => item.id === parsed.attachmentId);

  if (!isLikelyAudioAttachment(matched, label)) {
    const displayName = matched?.fileName || label?.trim() || parsed.attachmentId;
    const sizeText = formatSize(matched?.size);
    const handleDownload = async () => {
      if (downloading) return;
      setDownloading(true);
      try {
        const objectUrl = await acquireNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = displayName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => releaseNoteMediaObjectUrl(parsed.noteId, parsed.attachmentId), 5_000);
      } finally {
        setDownloading(false);
      }
    };

    return (
      <NodeViewWrapper className="my-2.5" contentEditable={false}>
        <div className="flex max-w-md items-center gap-3 rounded-xl border border-edge bg-surface-panel px-3.5 py-2.5 transition-colors hover:bg-surface-hover">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-inset text-fg-muted">
            <FileText className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-fg" title={displayName}>{displayName}</div>
            {sizeText ? <div className="text-xs text-fg-muted">{sizeText}</div> : null}
          </div>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            title={zh ? '下载附件' : 'Download attachment'}
            aria-label={`${zh ? '下载附件' : 'Download attachment'}: ${displayName}`}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-base hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          </button>
        </div>
      </NodeViewWrapper>
    );
  }

  const durationMatch = label?.match(/(\d+):(\d+)/);
  const durationSec = matched?.duration ?? (durationMatch
    ? Number(durationMatch[1]) * 60 + Number(durationMatch[2])
    : undefined);

  const attachment: NoteAttachment = matched ?? {
    id: parsed.attachmentId,
    type: 'audio',
    mimeType: 'audio/webm',
    fileName: label ?? '',
    size: 0,
    relativePath: '',
    duration: durationSec,
  };

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      <VoiceNotePlayer
        noteId={parsed.noteId}
        attachment={attachment}
        transcript={matched?.transcript}
        className="max-w-md"
      />
    </NodeViewWrapper>
  );
}
