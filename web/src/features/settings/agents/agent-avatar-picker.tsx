import * as Popover from '@radix-ui/react-popover';
import { Upload } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import {
  deleteAgentAvatarFile,
  uploadAgentAvatarFile,
} from '@/features/settings/agents-admin-api';

import { AgentAvatarDisplay } from './agent-avatar-display';
import {
  DICEBEAR_MORE_SEEDS,
  DICEBEAR_ROW_SEEDS,
  DICEBEAR_STYLE_ORDER,
  XOPC_CUSTOM_AVATAR,
  buildXopcDicebearValue,
  dicebearToDataUri,
  parseXopcDicebearValue,
  type DicebearStyleId,
} from './agent-avatar-dicebear';

function styleLabel(style: DicebearStyleId, a: AgentsSettingsMessages): string {
  switch (style) {
    case 'pixel-art':
      return a.avatarStylePixelArt;
    case 'adventurer':
      return a.avatarStyleAdventurer;
    case 'bottts':
      return a.avatarStyleRobot;
    case 'lorelei':
      return a.avatarStyleLorelei;
    default:
      return style;
  }
}

export function AgentAvatarPicker(props: {
  agentId: string;
  value: string;
  onChange: (next: string) => void;
  a: AgentsSettingsMessages;
}) {
  const { agentId, value, onChange, a } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const activeStyle = useMemo((): DicebearStyleId => {
    const p = parseXopcDicebearValue(value.trim());
    if (p) {
      return p.styleId;
    }
    return 'pixel-art';
  }, [value]);

  const pickDicebear = useCallback(
    async (styleId: DicebearStyleId, seed: string) => {
      try {
        await deleteAgentAvatarFile(agentId);
      } catch {
        /* best-effort: clear binary when switching away from custom */
      }
      onChange(buildXopcDicebearValue(styleId, seed));
      setMoreOpen(false);
    },
    [agentId, onChange],
  );

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) {
        return;
      }
      setUploadError(null);
      setUploadBusy(true);
      try {
        await uploadAgentAvatarFile(agentId, file);
        onChange(XOPC_CUSTOM_AVATAR);
      } catch (err) {
        const code = err instanceof Error ? err.message : '';
        if (code === 'avatar_too_large') {
          setUploadError(a.avatarTooLarge);
        } else if (code === 'unsupported_image_type' || code === 'empty_file') {
          setUploadError(a.avatarInvalidImage);
        } else {
          setUploadError(a.avatarUploadFailed);
        }
      } finally {
        setUploadBusy(false);
      }
    },
    [a, agentId, onChange],
  );

  const isRowSeedActive = (styleId: DicebearStyleId, seed: string) => {
    const p = parseXopcDicebearValue(value.trim());
    return Boolean(p && p.styleId === styleId && p.seed === seed);
  };

  return (
    <div id="agent-avatar-settings" className="flex flex-col gap-3 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg">{a.avatarPickerTitle}</span>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(ev) => void onFile(ev)}
          />
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5 px-2.5 py-1.5 text-xs"
            disabled={uploadBusy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {uploadBusy ? a.avatarUploading : a.avatarUploadCustom}
          </Button>
        </div>
      </div>

      {uploadError ? <p className="text-xs text-red-600 dark:text-red-400">{uploadError}</p> : null}

      <div className="flex flex-wrap gap-2">
        {DICEBEAR_STYLE_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => void pickDicebear(id, DICEBEAR_ROW_SEEDS[0] ?? agentId)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              activeStyle === id
                ? 'border-fg bg-fg text-surface-base'
                : 'border-edge-subtle bg-surface-panel text-fg hover:border-edge',
            )}
          >
            {styleLabel(id, a)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-edge-subtle bg-surface-panel/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {DICEBEAR_ROW_SEEDS.map((seed) => (
            <button
              key={seed}
              type="button"
              title={seed}
              onClick={() => void pickDicebear(activeStyle, seed)}
              className={cn(
                'flex size-12 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                isRowSeedActive(activeStyle, seed)
                  ? 'border-accent ring-2 ring-accent/30'
                  : 'border-transparent hover:border-edge',
              )}
            >
              <img
                src={dicebearToDataUri(activeStyle, seed, 96)}
                alt=""
                width={44}
                height={44}
                className="size-11 rounded-full object-cover"
                draggable={false}
              />
            </button>
          ))}

          <Popover.Root open={moreOpen} onOpenChange={setMoreOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-edge-subtle bg-surface-base text-xs font-medium text-fg-muted hover:border-edge hover:text-fg"
              >
                {a.avatarMore}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="z-[80] max-h-72 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-edge-subtle bg-surface-panel p-3 shadow-lg"
                sideOffset={6}
                align="end"
              >
                <p className="mb-2 text-xs font-medium text-fg-muted">{styleLabel(activeStyle, a)}</p>
                <div className="flex flex-wrap gap-2">
                  {DICEBEAR_MORE_SEEDS.map((seed) => (
                    <button
                      key={seed}
                      type="button"
                      title={seed}
                      onClick={() => void pickDicebear(activeStyle, seed)}
                      className={cn(
                        'flex size-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        isRowSeedActive(activeStyle, seed)
                          ? 'border-accent ring-2 ring-accent/30'
                          : 'border-transparent hover:border-edge',
                      )}
                    >
                      <img
                        src={dicebearToDataUri(activeStyle, seed, 88)}
                        alt=""
                        width={40}
                        height={40}
                        className="size-10 rounded-full object-cover"
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-edge-subtle pt-3">
          <span className="text-xs text-fg-muted">{a.personaAvatar}</span>
          <AgentAvatarDisplay agentId={agentId} avatar={value} size={40} />
          {value.trim() && !parseXopcDicebearValue(value.trim()) && value.trim() !== XOPC_CUSTOM_AVATAR ? (
            <span className="truncate font-mono text-[10px] text-fg-muted" title={value}>
              {value}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
