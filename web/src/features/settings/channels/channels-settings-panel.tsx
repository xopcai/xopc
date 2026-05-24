import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { docsGuidePageUrl } from '@/navigation';

import { ChannelsHubGrid, type OpenChannelOptions } from './channels-hub-grid';
import { ChannelsHubGridSkeleton } from './channels-hub-card-skeleton';
import {
  CHANNELS_HUB_PATH,
  channelDetailPath,
  isManageableChannelId,
  normalizeChannelRouteId,
} from './channels-routes';
import { ChannelsRemoveChannelDialog } from './channels-remove-channel-dialog';
import { ChannelsSummaryStrip } from './channels-summary-strip';
import { ExtensionChannelDetailPanel } from './extension-channel-detail-panel';
import { FeishuMoreSettingsSection } from './feishu-more-settings-section';
import { FeishuQrSetupDialog } from './feishu-qr-setup-dialog';
import { TelegramChannelSettingsDialog } from './telegram-channel-settings-dialog';
import { useChannelCatalog } from './use-channel-catalog';
import { useChannelsHubData } from './use-channels-hub-data';
import { useChannelsSettingsPanel } from './use-channels-settings-panel';
import { WeixinQrLoginDialog } from './weixin-qr-login-dialog';
import { WeixinMoreSettingsSection } from './weixin-more-settings-section';

export function ChannelsSettingsPanel() {
  const navigate = useNavigate();
  const { channelId: routeChannelId } = useParams<{ channelId?: string }>();
  const [searchParams] = useSearchParams();

  const ctx = useChannelsSettingsPanel();
  const {
    language,
    m,
    ch,
    hasToken,
    loading,
    fetchError,
    mutate,
    form,
    baseline,
    dirty,
    saving,
    error,
    saveOk,
    removeTarget,
    setRemoveTarget,
    weixinSuccessBanner,
    setWeixinSuccessBanner,
    feishuSetupSuccessBanner,
    tgAdvanced,
    setTgAdvanced,
    showToken,
    setShowToken,
    showFeishuSecret,
    setShowFeishuSecret,
    showFeishuWebhookSecrets,
    setShowFeishuWebhookSecrets,
    copied,
    feishuCopied,
    feishuWebhookCopied,
    tgAccountsDraft,
    setTgAccountsDraft,
    tgAccountsError,
    wxAccountsDraft,
    setWxAccountsDraft,
    wxAccountsError,
    feishuAccountsDraft,
    setFeishuAccountsDraft,
    feishuAccountsError,
    chatAgents,
    updateChannelAgentRoute,
    updateTelegram,
    updateWeixin,
    updateFeishu,
    save,
    discard,
    toggleChannelEnabled,
    removeChannel,
    copyToken,
    handleFeishuQrSetupSuccess,
    copyFeishuSecret,
    copyFeishuWebhookConfig,
    onTgAccountsBlur,
    onWxAccountsBlur,
    onFeishuAccountsBlur,
    dmOpts,
    groupOpts,
    replyOpts,
    streamOpts,
  } = ctx;

  const [refreshing, setRefreshing] = useState(false);

  const { entries: catalogEntries } = useChannelCatalog(hasToken, ch);
  const catalogById = useMemo(() => new Map(catalogEntries.map((e) => [e.id, e])), [catalogEntries]);

  const activeChannelId = normalizeChannelRouteId(routeChannelId);
  const scrollToPairing = searchParams.get('pairing') === '1';
  const detailOpen = Boolean(activeChannelId && catalogById.has(activeChannelId));

  const { cards, hubSummary, refreshAll } = useChannelsHubData({
    hasToken,
    form,
    ch,
  });

  const activeEntry = activeChannelId ? catalogById.get(activeChannelId) : undefined;
  const activeCard = activeChannelId ? cards.find((c) => c.id === activeChannelId) : undefined;

  useEffect(() => {
    if (!activeChannelId || catalogEntries.length === 0) return;
    if (!catalogById.has(activeChannelId)) {
      navigate(CHANNELS_HUB_PATH, { replace: true });
    }
  }, [activeChannelId, catalogById, catalogEntries.length, navigate]);

  const resolveChannelTitle = useCallback(
    (id: string) => catalogById.get(id)?.title ?? id,
    [catalogById],
  );

  const openChannel = useCallback(
    (id: string, opts?: OpenChannelOptions) => {
      navigate(channelDetailPath(id, { pairing: opts?.scrollToPairing }));
    },
    [navigate],
  );

  const closeChannel = useCallback(() => {
    navigate(CHANNELS_HUB_PATH);
  }, [navigate]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      refreshAll();
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate, refreshAll]);

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.channels}</h1>
        <p className="text-sm text-fg-muted">{ch.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
        <div className="space-y-2">
          <div className="h-7 w-40 animate-pulse rounded-md bg-surface-hover motion-reduce:animate-none dark:bg-surface-active/50" />
          <div className="h-4 w-full max-w-md animate-pulse rounded-md bg-surface-hover motion-reduce:animate-none dark:bg-surface-active/50" />
        </div>
        <div className="h-16 animate-pulse rounded-xl bg-surface-hover motion-reduce:animate-none dark:bg-surface-active/50" />
        <ChannelsHubGridSkeleton />
        <p className="text-sm text-fg-muted">{ch.loading}</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <p className="text-sm text-fg-muted">{error ?? fetchError ?? ch.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void mutate()}>
          {ch.retry}
        </Button>
      </div>
    );
  }

  const wx = form.weixin;
  const pairingFocusWeixin = scrollToPairing && activeChannelId === 'weixin';
  const pairingFocusFeishu = scrollToPairing && activeChannelId === 'feishu';

  const weixinMoreSettings = (
    <WeixinMoreSettingsSection
      ch={ch}
      wx={wx}
      updateWeixin={updateWeixin}
      dmOpts={dmOpts}
      streamOpts={streamOpts}
      wxAccountsDraft={wxAccountsDraft}
      setWxAccountsDraft={setWxAccountsDraft}
      wxAccountsError={wxAccountsError}
      onWxAccountsBlur={onWxAccountsBlur}
      form={form}
      chatAgents={chatAgents}
      onAgentRouteChange={(acc, aid) => updateChannelAgentRoute('weixin', acc, aid)}
      saving={saving}
      language={language}
      dialogOpen={detailOpen && activeChannelId === 'weixin'}
      pairingFocus={pairingFocusWeixin}
    />
  );

  const feishuMoreSettings = (
    <FeishuMoreSettingsSection
      ch={ch}
      form={form}
      baseline={baseline}
      showFeishuSecret={showFeishuSecret}
      setShowFeishuSecret={setShowFeishuSecret}
      showFeishuWebhookSecrets={showFeishuWebhookSecrets}
      setShowFeishuWebhookSecrets={setShowFeishuWebhookSecrets}
      feishuCopied={feishuCopied}
      feishuWebhookCopied={feishuWebhookCopied}
      copyFeishuSecret={copyFeishuSecret}
      copyFeishuWebhookConfig={copyFeishuWebhookConfig}
      updateFeishu={updateFeishu}
      updateChannelAgentRoute={updateChannelAgentRoute}
      feishuAccountsDraft={feishuAccountsDraft}
      setFeishuAccountsDraft={setFeishuAccountsDraft}
      feishuAccountsError={feishuAccountsError}
      onFeishuAccountsBlur={onFeishuAccountsBlur}
      dmOpts={dmOpts}
      groupOpts={groupOpts}
      chatAgents={chatAgents}
      saving={saving}
      language={language}
      dialogOpen={detailOpen && activeChannelId === 'feishu'}
      pairingFocus={pairingFocusFeishu}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.channels}</h1>
        <p className="mt-1 text-sm text-fg-muted">{ch.subtitle}</p>
        <a
          href={docsGuidePageUrl(language, 'channels')}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {ch.docsLink}
          <ExternalLink className="size-3.5" />
        </a>
      </header>

      {hubSummary ? (
        <ChannelsSummaryStrip
          summary={hubSummary}
          ch={ch}
          saveOk={saveOk}
          refreshing={refreshing}
          resolveChannelTitle={resolveChannelTitle}
          onRefresh={() => void handleRefresh()}
        />
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {weixinSuccessBanner ? <p className="text-xs text-accent">{weixinSuccessBanner}</p> : null}
      {feishuSetupSuccessBanner ? (
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">
          {feishuSetupSuccessBanner}
        </div>
      ) : null}

      {refreshing ? (
        <ChannelsHubGridSkeleton count={Math.max(catalogEntries.length, 3)} />
      ) : (
        <ChannelsHubGrid
          catalog={catalogEntries}
          cards={cards}
          ch={ch}
          saving={saving}
          onOpenChannel={openChannel}
          onToggleChannel={(id, enabled) => {
            if (isManageableChannelId(id)) void toggleChannelEnabled(id, enabled);
          }}
          onRemoveChannel={(id) => {
            if (isManageableChannelId(id)) setRemoveTarget(id);
          }}
          onViewDocs={() => window.open(docsGuidePageUrl(language, 'channels'), '_blank', 'noopener,noreferrer')}
        />
      )}

      {activeChannelId === 'weixin' ? (
        <WeixinQrLoginDialog
          open={detailOpen}
          onOpenChange={(open) => {
            if (!open) closeChannel();
          }}
          ch={ch}
          onLoginSuccess={async () => {
            await mutate();
            setWeixinSuccessBanner(ch.weixinQrLoginSuccess);
            window.setTimeout(() => setWeixinSuccessBanner(null), 4000);
          }}
          moreSettings={weixinMoreSettings}
          settingsDirty={dirty}
          settingsSaving={saving}
          onSettingsDiscard={discard}
          onSettingsSave={save}
        />
      ) : null}

      {activeChannelId === 'telegram' ? (
        <TelegramChannelSettingsDialog
          open={detailOpen}
          onOpenChange={(open) => {
            if (!open) closeChannel();
          }}
          ch={ch}
          form={form}
          baseline={baseline}
          tgAdvanced={tgAdvanced}
          setTgAdvanced={setTgAdvanced}
          showToken={showToken}
          setShowToken={setShowToken}
          copied={copied}
          copyToken={copyToken}
          updateTelegram={updateTelegram}
          updateChannelAgentRoute={updateChannelAgentRoute}
          tgAccountsDraft={tgAccountsDraft}
          setTgAccountsDraft={setTgAccountsDraft}
          tgAccountsError={tgAccountsError}
          onTgAccountsBlur={onTgAccountsBlur}
          dmOpts={dmOpts}
          groupOpts={groupOpts}
          replyOpts={replyOpts}
          streamOpts={streamOpts}
          chatAgents={chatAgents}
          saving={saving}
          dirty={dirty}
          save={save}
          discard={discard}
          language={language}
          scrollToPairingOnOpen={scrollToPairing}
          closeOnSave={false}
        />
      ) : null}

      {activeChannelId === 'feishu' ? (
        <FeishuQrSetupDialog
          open={detailOpen}
          onOpenChange={(open) => {
            if (!open) closeChannel();
          }}
          ch={ch}
          onSetupSuccess={handleFeishuQrSetupSuccess}
          moreSettings={feishuMoreSettings}
          settingsDirty={dirty}
          settingsSaving={saving}
          onSettingsDiscard={discard}
          onSettingsSave={save}
        />
      ) : null}

      {activeEntry && activeCard && !activeEntry.manageable ? (
        <ExtensionChannelDetailPanel
          open={detailOpen}
          onOpenChange={(open) => {
            if (!open) closeChannel();
          }}
          entry={activeEntry}
          vm={activeCard}
          ch={ch}
          language={language}
        />
      ) : null}

      <ChannelsRemoveChannelDialog
        open={removeTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRemoveTarget(null);
        }}
        ch={ch}
        removeTarget={removeTarget}
        onCancel={() => setRemoveTarget(null)}
        saving={saving}
        onConfirmRemove={() => void removeChannel()}
      />
    </div>
  );
}
