import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useUiExtensions } from '@/features/extensions/extension-provider';
import type { ExtensionCommandContribution } from '@/features/extensions/types';
import { evaluateWhen } from '@/lib/when-evaluator';
import { useContextStore } from '@/stores/context-store';

type ResolvedCommand = {
  extensionId: string;
  extensionName: string;
  command: ExtensionCommandContribution;
};

function useExtensionCommands(): ResolvedCommand[] {
  const uiExtensions = useUiExtensions();
  const contextVariables = useContextStore((s) => s.variables);
  return useMemo(() => {
    const commands: ResolvedCommand[] = [];
    for (const extension of uiExtensions) {
      const list = extension.ui?.contributions?.commands;
      if (!Array.isArray(list)) continue;
      for (const command of list) {
        if (command && typeof command.id === 'string' && typeof command.title === 'string') {
          const when = typeof command.when === 'string' ? command.when : undefined;
          if (!evaluateWhen(when, contextVariables)) continue;
          commands.push({
            extensionId: extension.id,
            extensionName: extension.name,
            command,
          });
        }
      }
    }
    return commands;
  }, [uiExtensions, contextVariables]);
}

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const allCommands = useExtensionCommands();

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const filteredCommands = allCommands.filter((item) => {
    if (!query.trim()) return true;
    const lowerQuery = query.toLowerCase();
    return (
      item.command.title.toLowerCase().includes(lowerQuery) ||
      item.extensionName.toLowerCase().includes(lowerQuery)
    );
  });

  function executeCommand(item: ResolvedCommand) {
    onClose();
    const { command, extensionId } = item;
    if (command.opensPanel !== undefined && command.opensPanel !== '') {
      navigate(`/apps/${encodeURIComponent(extensionId)}`);
    } else {
      window.dispatchEvent(
        new CustomEvent('extension-command', {
          detail: { extensionId, commandId: command.id },
        }),
      );
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[min(20vh,8rem)]"
      role="dialog"
      aria-modal="true"
      aria-label="Extension commands"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands…"
          className="border-b border-edge bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-muted"
          autoComplete="off"
          autoCorrect="off"
        />
        <ul className="max-h-[min(50vh,20rem)] overflow-y-auto p-2 text-sm">
          {filteredCommands.length === 0 ? (
            <li className="rounded-lg px-3 py-6 text-center text-fg-muted">No commands</li>
          ) : (
            filteredCommands.map((item) => (
              <li key={`${item.extensionId}:${item.command.id}`}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-fg hover:bg-surface-muted"
                  onClick={() => executeCommand(item)}
                >
                  <span>{item.command.title}</span>
                  <span className="text-xs text-fg-muted">{item.extensionName}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * Mount once inside AppShell. Listens for Cmd+K / Ctrl+K and the
 * `open-command-palette` CustomEvent to open the palette.
 */
export function ExtensionCommandPaletteHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-command-palette', handler);
    return () => window.removeEventListener('open-command-palette', handler);
  }, []);

  return <CommandPalette open={open} onClose={() => setOpen(false)} />;
}
