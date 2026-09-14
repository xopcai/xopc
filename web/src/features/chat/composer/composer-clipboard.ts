function fileDedupeKey(f: File): string {
  return `${f.name}\0${f.size}`;
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
