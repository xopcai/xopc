import { File, FileArchive, FileCode2, FileImage, FileJson, FileMusic, FileSpreadsheet, FileText, FileVideo, Presentation } from 'lucide-react';

import { fileExtColor } from '@/features/file-tree/file-tree-utils';
import { cn } from '@/lib/cn';

/** A consistent file glyph for preview headers, tree rows, and search results. */
export function FileIcon({ name, className }: { name: string; className?: string }) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const Icon = /^(tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|sh|css|scss|html|vue|svelte)$/.test(extension) ? FileCode2
    : /^(json|jsonc|jsonl)$/.test(extension) ? FileJson
      : /^(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/.test(extension) ? FileImage
        : /^(xlsx?|csv|tsv|ods)$/.test(extension) ? FileSpreadsheet
          : /^(pptx?|odp)$/.test(extension) ? Presentation
            : /^(mp3|wav|ogg|flac|m4a|aac)$/.test(extension) ? FileMusic
              : /^(mp4|webm|mov|mkv|avi)$/.test(extension) ? FileVideo
                : /^(zip|gz|tar|rar|7z|bz2)$/.test(extension) ? FileArchive
                  : /^(md|mdx|txt|pdf|docx?|log|ya?ml|toml)$/.test(extension) ? FileText : File;
  return <Icon className={cn('size-4 shrink-0', fileExtColor(name), className)} strokeWidth={1.75} aria-hidden />;
}
