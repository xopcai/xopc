import { Link2, Loader2, PlugZap, Trash2, Unlink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  closeOAuthAuthorizationWindow,
  openOAuthAuthorizationUrl,
  reserveOAuthAuthorizationWindow,
} from '@/features/settings/oauth-authorization-window';
import { messages } from '@/i18n/messages';

import {
  disconnectMcpOAuth,
  getMcpOAuthStatus,
  startMcpOAuth,
  testMcpServer,
  type McpOAuthStatus,
  type McpServerRow,
} from '../mcp/mcp-config-api';
import { mcpServerEndpointSummary } from '../mcp/mcp-server-endpoint-summary';
import { formatConnectorMessage } from '../utils/connector-i18n';

export function CustomMcpServerRow({
  row,
  t,
  cs,
  onEdit,
  onRemove,
}: {
  row: McpServerRow;
  t: ReturnType<typeof messages>['mcpSettings'];
  cs: ReturnType<typeof messages>['connectorsSettings'];
  onEdit: () => void;
  onRemove: () => Promise<void>;
}) {
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [capabilityCounts, setCapabilityCounts] = useState<{
    toolCount: number;
    resourceCount: number;
    promptCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<McpOAuthStatus | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const summary = mcpServerEndpointSummary(row);
  const usesOAuth = row.transport === 'streamable-http' && row.auth === 'oauth';

  useEffect(() => {
    if (!usesOAuth) {
      setOauthStatus(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await getMcpOAuthStatus(row.id.trim());
        if (!cancelled) {
          setOauthStatus(next);
          if (next.status === 'error' && next.session?.error) setError(next.session.error);
          if (next.status === 'connected') setError(null);
        }
      } catch (statusError) {
        if (!cancelled) setError(statusError instanceof Error ? statusError.message : String(statusError));
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (oauthStatus?.status === 'authorizing') void refresh();
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [oauthStatus?.status, row.id, usesOAuth]);

  const connectOAuth = useCallback(async () => {
    setOauthBusy(true);
    setError(null);
    const popup = reserveOAuthAuthorizationWindow();
    try {
      const next = await startMcpOAuth(row.id.trim());
      setOauthStatus(next);
      if (next.status === 'error' && next.session?.error) setError(next.session.error);
      if (next.status === 'connected') setError(null);
      const authorizationUrl = next.session?.authorizationUrl;
      if (authorizationUrl) {
        const opened = await openOAuthAuthorizationUrl(authorizationUrl, popup);
        if (!opened) setError(t.oauthOpenFailed);
      } else {
        closeOAuthAuthorizationWindow(popup);
      }
    } catch (connectError) {
      closeOAuthAuthorizationWindow(popup);
      setError(connectError instanceof Error ? connectError.message : String(connectError));
    } finally {
      setOauthBusy(false);
    }
  }, [row.id, t.oauthOpenFailed]);

  const disconnectOAuth = useCallback(async () => {
    setOauthBusy(true);
    setError(null);
    try {
      setOauthStatus(await disconnectMcpOAuth(row.id.trim()));
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError));
    } finally {
      setOauthBusy(false);
    }
  }, [row.id]);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      const result = await testMcpServer(row.id.trim());
      setCapabilityCounts({
        toolCount: result.toolCount,
        resourceCount: result.resourceCount,
        promptCount: result.promptCount,
      });
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setTesting(false);
    }
  }, [row.id]);

  const remove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      await onRemove();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
      setRemoving(false);
    }
  }, [onRemove]);

  return (
    <div
      className="flex h-full min-h-[10.5rem] cursor-pointer flex-col rounded-lg bg-surface-panel p-4 shadow-surface transition-colors hover:bg-surface-hover/45"
      onClick={onEdit}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-fg">{row.id.trim() || t.cardUntitled}</h3>
          <span className="rounded-full bg-surface-base px-2 py-0.5 text-[11px] text-fg-muted">
            {cs.customBadge}
          </span>
          <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
            {t.transportLabels[row.transport]}
          </span>
          {usesOAuth && oauthStatus ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg">
              {t.oauthStatus[oauthStatus.status === 'not_configured' ? 'disconnected' : oauthStatus.status]}
            </span>
          ) : null}
        </div>
        {summary ? (
          <p className="mt-3 line-clamp-2 break-all font-mono text-xs leading-5 text-fg-subtle" title={summary}>
            {summary}
          </p>
        ) : null}
        {error ? <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
        {capabilityCounts ? (
          <p className="mt-3 text-sm text-fg-muted">
            {formatConnectorMessage(cs.customCapabilitySummary, {
              tools: String(capabilityCounts.toolCount),
              resources: String(capabilityCounts.resourceCount),
              prompts: String(capabilityCounts.promptCount),
            })}
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-edge pt-3" onClick={(event) => event.stopPropagation()}>
        <span className="text-xs text-fg-subtle">{cs.connectorDetails}</span>
        <div className="flex gap-2">
          {usesOAuth && oauthStatus?.status !== 'connected' ? (
            <Button variant="secondary" disabled={oauthBusy} onClick={() => void connectOAuth()}>
              {oauthBusy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              {oauthStatus?.status === 'authorizing' ? t.oauthOpenAuthorization : t.oauthConnect}
            </Button>
          ) : (
            <Button variant="secondary" disabled={testing} onClick={() => void runTest()}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
              {t.testConnection}
            </Button>
          )}
          {usesOAuth && oauthStatus?.status === 'connected' ? (
            <Button variant="ghost" disabled={oauthBusy} onClick={() => void disconnectOAuth()}>
              {oauthBusy ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
              {t.oauthDisconnect}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={removing} onClick={() => void remove()}>
            {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {t.removeServer}
          </Button>
        </div>
      </div>
    </div>
  );
}
