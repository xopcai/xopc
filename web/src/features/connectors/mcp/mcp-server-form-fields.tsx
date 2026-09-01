import type { ReactNode } from 'react';

import { McpHeadersEditor } from '@/features/connectors/mcp/mcp-headers-editor';
import {
  connectionTimeoutSeconds,
  parseConnectionTimeoutSeconds,
  parseRequestTimeoutSeconds,
  requestTimeoutSeconds,
  type McpServerRow,
  type McpAuthKind,
  type McpTransportKind,
} from '@/features/connectors/mcp/mcp-config-api';
import type { McpSettingsMessages } from '@/i18n/messages';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { Select, SelectOption } from '@/components/ui/popover-select';

const TRANSPORTS: McpTransportKind[] = ['stdio', 'sse', 'streamable-http'];
const AUTH_KINDS: McpAuthKind[] = ['none', 'oauth'];

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

type Props = {
  row: McpServerRow;
  t: McpSettingsMessages;
  onUpdate: (patch: Partial<McpServerRow>) => void;
  idConflictMessage?: string;
  variant?: 'all' | 'basic' | 'advanced';
};

export function McpServerFormFields({ row, t, onUpdate, idConflictMessage, variant = 'all' }: Props) {
  const showBasic = variant === 'all' || variant === 'basic';
  const showAdvanced = variant === 'all' || variant === 'advanced';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {showBasic ? (
        <>
          <Field label={t.transportLabel} required>
            <Select
              className={inputClassName()}
              value={row.transport}
              onChange={(e) => onUpdate({ transport: e.target.value as McpTransportKind })}
            >
              {TRANSPORTS.map((kind) => (
                <SelectOption key={kind} value={kind}>
                  {t.transportLabels[kind]}
                </SelectOption>
              ))}
            </Select>
          </Field>

          <Field label={t.serverIdLabel} required>
            <input
              className={inputClassName()}
              value={row.id}
              placeholder={t.serverIdPlaceholder}
              onChange={(e) => onUpdate({ id: e.target.value })}
            />
            {idConflictMessage ? (
              <p className="text-xs text-red-600 dark:text-red-300">{idConflictMessage}</p>
            ) : null}
          </Field>
        </>
      ) : null}

      {row.transport === 'stdio' ? (
        <>
          {showBasic ? (
            <div className={variant === 'basic' ? 'md:col-span-2' : undefined}>
              <Field label={t.commandLabel} required>
                <input
                  className={inputClassName()}
                  value={row.command}
                  onChange={(e) => onUpdate({ command: e.target.value })}
                />
              </Field>
            </div>
          ) : null}
          {showAdvanced ? (
            <>
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
          ) : null}
        </>
      ) : (
        <>
          {showBasic ? (
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
          ) : null}
          {showBasic && row.transport === 'streamable-http' ? (
            <>
              <Field label={t.authLabel} description={t.authHint}>
                <Select
                  className={inputClassName()}
                  value={row.auth}
                  onChange={(event) => {
                    const auth = event.target.value as McpAuthKind;
                    onUpdate({
                      auth,
                      headers: auth === 'oauth'
                        ? row.headers.filter((header) => header.key.trim().toLowerCase() !== 'authorization')
                        : row.headers,
                    });
                  }}
                >
                  {AUTH_KINDS.map((auth) => (
                    <SelectOption key={auth} value={auth}>{t.authLabels[auth]}</SelectOption>
                  ))}
                </Select>
              </Field>
              {row.auth === 'oauth' ? (
                <Field label={t.oauthClientIdLabel} description={t.oauthClientIdHint}>
                  <input
                    className={cn(inputClassName(), 'font-mono text-xs')}
                    value={row.oauthClientId}
                    placeholder={t.oauthClientIdPlaceholder}
                    onChange={(event) => onUpdate({ oauthClientId: event.target.value })}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          {showAdvanced ? (
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
              onChange={(headers) => onUpdate({
                headers: row.auth === 'oauth'
                  ? headers.filter((header) => header.key.trim().toLowerCase() !== 'authorization')
                  : headers,
              })}
            />
          ) : null}
        </>
      )}

      {showAdvanced ? (
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
      ) : null}
      {showAdvanced ? (
        <Field label={t.requestTimeoutLabel} description={t.requestTimeoutHint}>
          <input
            type="number"
            min={1}
            max={14_400}
            className={inputClassName()}
            value={requestTimeoutSeconds(row)}
            placeholder={t.requestTimeoutPlaceholder}
            onChange={(e) =>
              onUpdate({
                requestTimeoutMs: parseRequestTimeoutSeconds(e.target.value),
              })
            }
          />
        </Field>
      ) : null}
    </div>
  );
}
