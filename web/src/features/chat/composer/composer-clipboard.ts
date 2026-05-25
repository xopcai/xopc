const ACCEPT =
  'image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml,.zip';

const ACCEPT_TOKENS = ACCEPT.split(',')
  .map((t) => t.trim())
  .filter(Boolean);

export { ACCEPT };

function fileDedupeKey(f: File): string {
  return `${f.name}\0${f.size}`;
}

/** Matches hidden `<input accept={ACCEPT}>`. Exported for unit tests. */
export function isComposerAcceptableFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const nameLower = file.name.toLowerCase();
  for (const token of ACCEPT_TOKENS) {
    const t = token.toLowerCase();
    if (t.endsWith('/*')) {
      const prefix = t.slice(0, -1);
      if (mime.startsWith(prefix)) return true;
    } else if (token.startsWith('.')) {
      if (nameLower.endsWith(token.toLowerCase())) return true;
    } else if (mime === t) {
      return true;
    }
  }
  return false;
}

/** Merges `DataTransfer.files` and `kind === 'file'` items; dedupes; skips empty blobs. Exported for unit tests. */
export function collectClipboardFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: File[] = [];
  const add = (f: File | null) => {
    if (!f || f.size === 0) return;
    const key = fileDedupeKey(f);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  const { files } = data;
  if (files?.length) {
    for (let i = 0; i < files.length; i++) {
      add(files.item(i));
    }
  }
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') {
      add(item.getAsFile());
    }
  }
  return out;
}
