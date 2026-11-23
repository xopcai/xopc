import { ArrowUpRight, Hash, Link2, Plus, Sparkles, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { listNoteBacklinks, updateNote } from './notes-api';

function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/[\s,，]+/g, '-')
    .slice(0, 32);
}

export interface NoteTagBarProps {
  noteId: string;
  tags?: string[];
  suggestedTags?: string[];
  readOnly?: boolean;
  onUpdated?: () => void;
  className?: string;
}

export function NoteTagBar({
  noteId,
  tags = [],
  suggestedTags = [],
  readOnly = false,
  onUpdated,
  className,
}: NoteTagBarProps) {
  const zh = useLocaleStore((s) => s.language === 'zh');
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const unusedSuggestions = suggestedTags.filter(
    (s) => s.trim() && !tags.includes(normalizeTag(s)),
  );

  if (readOnly && tags.length === 0) return null;

  const commitTags = async (nextTags: string[]) => {
    const deduped = Array.from(new Set(nextTags.map(normalizeTag).filter(Boolean)));
    setSaving(true);
    try {
      await updateNote(noteId, { tags: deduped });
      window.dispatchEvent(new CustomEvent('note-updated', { detail: { noteId } }));
      onUpdated?.();
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (raw: string) => {
    const clean = normalizeTag(raw);
    if (!clean) {
      setDraft('');
      setAdding(false);
      return;
    }
    setDraft('');
    setAdding(false);
    if (tags.includes(clean)) return;
    await commitTags([...tags, clean]);
  };

  const handleRemove = async (target: string) => {
    await commitTags(tags.filter((t) => t !== target));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      void handleAdd(draft);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft('');
      setAdding(false);
    } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
      event.preventDefault();
      void handleRemove(tags[tags.length - 1]);
    }
  };

  return (
    <div className={cn('mt-2 flex flex-wrap items-center gap-1.5', className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="group inline-flex h-6 items-center gap-1 rounded-md border border-edge-subtle bg-surface-inset px-2 text-xs text-fg-muted transition-colors hover:border-edge hover:text-fg"
        >
          <button
            type="button"
            onClick={() => navigate(`/notes?tag=${encodeURIComponent(tag)}`)}
            className="inline-flex items-center gap-0.5 hover:text-accent-fg focus:outline-none"
            title={zh ? `按 #${tag} 筛选笔记` : `Filter by #${tag}`}
          >
            <Hash className="size-3 text-fg-subtle" aria-hidden />
            <span>{tag}</span>
          </button>
          {!readOnly ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleRemove(tag)}
              aria-label={zh ? `移除标签 ${tag}` : `Remove tag ${tag}`}
              className="rounded p-0.5 text-fg-subtle opacity-60 hover:bg-surface-hover hover:text-fg group-hover:opacity-100 disabled:opacity-30"
            >
              <X className="size-2.5" aria-hidden />
            </button>
          ) : null}
        </span>
      ))}

      {!readOnly && unusedSuggestions.slice(0, 3).map((suggestion) => {
        const clean = normalizeTag(suggestion);
        if (!clean) return null;
        return (
          <button
            key={`suggest-${clean}`}
            type="button"
            disabled={saving}
            onClick={() => void handleAdd(clean)}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-accent/35 bg-accent-soft/40 px-2 text-xs text-accent-fg transition-colors hover:bg-accent-soft disabled:opacity-40"
            title={zh ? '采纳 AI 建议标签' : 'Accept AI suggested tag'}
          >
            <Sparkles className="size-2.5" aria-hidden />
            <span>+{clean}</span>
          </button>
        );
      })}

      {!readOnly ? (
        adding ? (
          <input
            type="text"
            autoFocus
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void handleAdd(draft)}
            placeholder={zh ? '输入标签回车…' : 'Tag name…'}
            aria-label={zh ? '新标签名称' : 'New tag name'}
            className="h-6 w-28 rounded-md border border-accent bg-surface-panel px-2 text-xs text-fg outline-none placeholder:text-fg-subtle"
          />
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => setAdding(true)}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Plus className="size-3" aria-hidden />
            <span>{zh ? '标签' : 'Tag'}</span>
          </button>
        )
      ) : null}
    </div>
  );
}

export function NoteBacklinksSection({ noteId, className }: { noteId: string; className?: string }) {
  const zh = useLocaleStore((s) => s.language === 'zh');
  const token = useGatewayStore((s) => s.conversationId);
  const navigate = useNavigate();
  const { data } = useSWR(
    token ? ['note-backlinks', noteId, token] : null,
    () => listNoteBacklinks(noteId).catch(() => ({ items: [] })),
  );

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section
      aria-label={zh ? '反向链接' : 'Backlinks'}
      className={cn('mt-6 border-t border-edge-subtle pt-4', className)}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <Link2 className="size-3.5 text-fg-subtle" aria-hidden />
        <span>{zh ? `引用此笔记（${items.length}）` : `Linked from (${items.length})`}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(`/notes/${encodeURIComponent(item.id)}`)}
            className="group inline-flex max-w-xs items-center gap-1.5 rounded-lg border border-edge-subtle bg-surface-inset px-2.5 py-1.5 text-left text-xs text-fg transition-colors hover:border-edge hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="truncate font-medium group-hover:text-accent-fg">
              {item.title?.trim() || item.snippet?.slice(0, 28) || (zh ? '无标题笔记' : 'Untitled note')}
            </span>
            <ArrowUpRight className="size-3 shrink-0 text-fg-subtle group-hover:text-accent-fg" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}
