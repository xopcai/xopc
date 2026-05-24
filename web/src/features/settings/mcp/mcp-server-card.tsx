import { ChevronDown, Loader2, Plug, Trash2, Wrench, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { McpHeadersEditor } from '@/features/settings/mcp/mcp-headers-editor';
import {
  connectionTimeoutSeconds,
  parseConnectionTimeoutSeconds,
  type McpServerRow,
  type McpToolInfo,
  type McpTransportKind,
} from '@/features/settings/mcp/mcp-config-api';
import type { McpSettingsMessages } from '@/i18n/messages';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

const TRANSPORTS: McpTransportKind[] = ['stdio', 'sse', 'streamable-http'];

type ServerToolsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; tools: McpToolInfo[] }
  | { status: 'error'; message: string };

function Field({
  label,
  description,
  required,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-medium text-fg">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </div>
      {children}
      {description ? <p className="text-xs leading-relaxed text-fg-subtle">{description}</p> : null}
    </div>
  );
}

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
  );
}

function serverEndpointSummary(row: McpServerRow): string {
  if (row.transport === 'stdio') {
    const command = row.command.trim();
    if (!command) return '';
    const args = row.argsText.trim();
    return args ? `${command} ${args}` : command;
  }
  return row.url.trim();
}

type Props = {
  row: McpServerRow;
  expanded: boolean;
  onToggle: () => void;
  t: McpSettingsMessages;
  testing: boolean;
  toolState: ServerToolsState;
  onUpdate: (patch: Partial<McpServerRow>) => void;
  onRemove: () => void;
  onTest: () => void;
  onViewTools: (tools: McpToolInfo[]) => void;
};

export function McpServerCard({
  row,
  expanded,
  onToggle,
  t,
  testing,
  toolState,
  onUpdate,
  onRemove,
  onTest,
  onViewTools,
}: Props) {
  const title = row.id.trim() || t.cardUntitled;
  const summary = serverEndpointSummary(row);
  const transportLabel = t.transportLabels[row.transport];

  return (
    <div className="rounded-xl border border-edge bg-surface-panel">
      <div className="flex items-start gap-2 p-4">
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left hover:opacity-90',
            interaction.press,
          )}
          aria-expanded={expanded}
          aria-label={expanded ? t.cardCollapseAria : t.cardExpandAria}
          onClick={onToggle}
        >
          <ChevronDown
            className={cn(
              'mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Plug className="size-4 shrink-0 text-accent" aria-hidden />
              <span className="truncate font-medium text-fg">{title}</span>
              <span className="rounded-md border border-edge bg-surface-base px-1.5 py-0.5 text-[11px] text-fg-muted">
                {transportLabel}
              </span>
              {toolState.status === 'ok' && toolState.tools.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-base px-1.5 py-0.5 text-[11px] text-fg-muted">
                  <Wrench className="size-3" aria-hidden />
                  {toolState.tools.length}
                </span>
              ) : null}
            </div>
            {!expanded && summary ? (
              <p className="mt-1 truncate font-mono text-xs text-fg-subtle" title={summary}>
                {summary}
              </p>
            ) : null}
            {!expanded && toolState.status === 'error' ? (
              <p className="mt-1 truncate text-xs text-red-600 dark:text-red-300" title={toolState.message}>
                {toolState.message}
              </p>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={!row.id.trim() || testing}
            onClick={(e) => {
              e.stopPropagation();
              onTest();
            }}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Zap className="size-4" aria-hidden />
            )}
            {t.testConnection}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            {t.removeServer}
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-edge px-4 pb-4 pt-3">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t.transportLabel} required>
              <select
                className={inputClassName()}
                value={row.transport}
                onChange={(e) => onUpdate({ transport: e.target.value as McpTransportKind })}
              >
                {TRANSPORTS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t.transportLabels[kind]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t.serverIdLabel} required>
              <input
                className={inputClassName()}
                value={row.id}
                placeholder={t.serverIdPlaceholder}
                onChange={(e) => onUpdate({ id: e.target.value })}
              />
            </Field>

            {row.transport === 'stdio' ? (
              <>
                <Field label={t.commandLabel}>
                  <input
                    className={inputClassName()}
                    value={row.command}
                    onChange={(e) => onUpdate({ command: e.target.value })}
                  />
                </Field>
                <Field label={t.argsLabel} description={t.argsHint}>
                  <input
                    className={inputClassName()}
                    value={row.argsText}
                    onChange={(e) => onUpdate({ argsText: e.target.value })}
                  />
                </Field>
                <Field label={t.cwdLabel}>
                  <input
                    className={inputClassName()}
                    value={row.cwd}
                    onChange={(e) => onUpdate({ cwd: e.target.value })}
                  />
                </Field>
                <Field label={t.envLabel} description={t.envHint}>
                  <textarea
                    className={cn(inputClassName(), 'min-h-[4rem] font-mono text-xs')}
                    value={row.envJson}
                    onChange={(e) => onUpdate({ envJson: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <div className="md:col-span-2">
                  <Field label={t.urlLabel} required>
                    <input
                      className={cn(inputClassName(), 'font-mono text-xs')}
                      value={row.url}
                      placeholder="https://example.com/mcp"
                      onChange={(e) => onUpdate({ url: e.target.value })}
                    />
                  </Field>
                </div>
                <McpHeadersEditor
                  label={t.headersLabel}
                  optionalLabel={t.optionalSuffix}
                  addLabel={t.addHeader}
                  removeHeaderAria={t.removeHeader}
                  pasteLabel={t.pasteHeaders}
                  pasteFailed={t.pasteHeadersFailed}
                  keyPlaceholder={t.headerKeyPlaceholder}
                  valuePlaceholder={t.headerValuePlaceholder}
                  headers={row.headers}
                  onChange={(headers) => onUpdate({ headers })}
                />
              </>
            )}

            <Field label={t.timeoutLabel} description={t.timeoutHint}>
              <input
                type="number"
                min={1}
                max={600}
                className={inputClassName()}
                value={connectionTimeoutSeconds(row)}
                placeholder={t.timeoutPlaceholder}
                onChange={(e) =>
                  onUpdate({
                    connectionTimeoutMs: parseConnectionTimeoutSeconds(e.target.value),
                  })
                }
              />
            </Field>
          </div>

          {toolState.status === 'loading' ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t.toolsLoading}
            </div>
          ) : null}

          {toolState.status === 'error' ? (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {toolState.message}
            </p>
          ) : null}

          {toolState.status === 'ok' ? (
            <div className="mt-4 rounded-lg border border-edge bg-surface-base px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-fg">
                  <Wrench className="size-4 text-accent" aria-hidden />
                  {toolState.tools.length === 0
                    ? t.toolsEmpty
                    : t.toolsTitle.replace('{{count}}', String(toolState.tools.length))}
                </div>
                {toolState.tools.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => onViewTools(toolState.tools)}
                  >
                    {t.viewAllTools}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
