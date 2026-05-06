import { ExternalLink, MessageCircle, MessageSquare, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { docsGuidePageUrl } from '@/navigation';

import { ChannelImHubCard } from './channel-im-hub-card';
import { ChannelsRemoveChannelDialog } from './channels-remove-channel-dialog';
import { DingtalkMoreSettingsSection } from './dingtalk-more-settings-section';
import { DingtalkQrSetupDialog } from './dingtalk-qr-setup-dialog';
import { FeishuMoreSettingsSection } from './feishu-more-settings-section';
import { FeishuQrSetupDialog } from './feishu-qr-setup-dialog';
import { TelegramChannelSettingsDialog } from './telegram-channel-settings-dialog';
import { useChannelsSettingsPanel } from './use-channels-settings-panel';
import { WeixinQrLoginDialog } from './weixin-qr-login-dialog';
import { WeixinMoreSettingsSection } from './weixin-more-settings-section';
import { isDingtalkConfigured, isFeishuConfigured, isTelegramConfigured, isWeixinConfigured } from './utils';

export function ChannelsSettingsPanel() {
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
    weixinModalOpen,
    setWeixinModalOpen,
    telegramModalOpen,
    setTelegramModalOpen,
    feishuModalOpen,
    setFeishuModalOpen,
    removeTarget,
    setRemoveTarget,
    weixinSuccessBanner,
    setWeixinSuccessBanner,
    dingtalkModalOpen,
    setDingtalkModalOpen,
    feishuSetupSuccessBanner,
    dingtalkSetupSuccessBanner,
    tgAdvanced,
    setTgAdvanced,
    showToken,
    setShowToken,
    showFeishuSecret,
    setShowFeishuSecret,
    showFeishuWebhookSecrets,
    setShowFeishuWebhookSecrets,
    showDingtalkSecret,
    setShowDingtalkSecret,
    copied,
    feishuCopied,
    dingtalkCopied,
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
    dingtalkAccountsDraft,
    setDingtalkAccountsDraft,
    dingtalkAccountsError,
    chatAgents,
    updateChannelAgentRoute,
    updateTelegram,
    updateWeixin,
    updateFeishu,
    updateDingtalk,
    save,
    toggleChannelEnabled,
    removeChannel,
    copyToken,
    handleFeishuQrSetupSuccess,
    handleDingtalkQrSetupSuccess,
    copyFeishuSecret,
    copyDingtalkSecret,
    copyFeishuWebhookConfig,
    onTgAccountsBlur,
    onWxAccountsBlur,
    onFeishuAccountsBlur,
    onDingtalkAccountsBlur,
    dmOpts,
    groupOpts,
    replyOpts,
    streamOpts,
  } = ctx;

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
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{ch.loading}</p>
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
  const tg = form.telegram;
  const fs = form.feishu;
  const dt = form.dingtalk;
  const weixinConfigured = isWeixinConfigured(wx);
  const telegramConfigured = isTelegramConfigured(tg);
  const feishuConfigured = isFeishuConfigured(fs);
  const dingtalkConfigured = isDingtalkConfigured(dt);

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
      dirty={dirty}
      save={save}
    />
  );

  const dingtalkMoreSettings = (
    <DingtalkMoreSettingsSection
      ch={ch}
      form={form}
      baseline={baseline}
      showDingtalkSecret={showDingtalkSecret}
      setShowDingtalkSecret={setShowDingtalkSecret}
      dingtalkCopied={dingtalkCopied}
      copyDingtalkSecret={copyDingtalkSecret}
      updateDingtalk={updateDingtalk}
      updateChannelAgentRoute={updateChannelAgentRoute}
      dingtalkAccountsDraft={dingtalkAccountsDraft}
      setDingtalkAccountsDraft={setDingtalkAccountsDraft}
      dingtalkAccountsError={dingtalkAccountsError}
      onDingtalkAccountsBlur={onDingtalkAccountsBlur}
      dmOpts={dmOpts}
      groupOpts={groupOpts}
      chatAgents={chatAgents}
      saving={saving}
      dirty={dirty}
      save={save}
    />
  );

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
      dirty={dirty}
      save={save}
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

      {dirty ? <p className="text-xs text-amber-800 dark:text-amber-200">{ch.unsavedHint}</p> : null}
      {saveOk ? <p className="text-xs text-fg-muted">{ch.saved}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {weixinSuccessBanner ? <p className="text-xs text-accent">{weixinSuccessBanner}</p> : null}
      {feishuSetupSuccessBanner ? (
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">
          {feishuSetupSuccessBanner}
        </div>
      ) : null}
      {dingtalkSetupSuccessBanner ? (
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm text-success">
          {dingtalkSetupSuccessBanner}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <ChannelImHubCard
          icon={<MessageSquare className="size-6 text-accent" strokeWidth={1.75} />}
          title={ch.weixinTitle}
          subtitle={ch.weixinSubtitle}
          configured={weixinConfigured}
          enabled={wx.enabled}
          toggleDisabled={saving}
          onToggle={(next) => void toggleChannelEnabled('weixin', next)}
          onConfigure={() => setWeixinModalOpen(true)}
          onEdit={() => setWeixinModalOpen(true)}
          onRemove={() => setRemoveTarget('weixin')}
          ch={ch}
        />
        <ChannelImHubCard
          icon={<Send className="size-6 text-accent" strokeWidth={1.75} />}
          title={ch.telegramTitle}
          subtitle={ch.telegramSubtitle}
          configured={telegramConfigured}
          enabled={tg.enabled}
          toggleDisabled={saving}
          onToggle={(next) => void toggleChannelEnabled('telegram', next)}
          onConfigure={() => setTelegramModalOpen(true)}
          onEdit={() => setTelegramModalOpen(true)}
          onRemove={() => setRemoveTarget('telegram')}
          ch={ch}
        />
        <ChannelImHubCard
          icon={<MessageSquare className="size-6 text-accent" strokeWidth={1.75} />}
          title={ch.feishuTitle}
          subtitle={ch.feishuSubtitle}
          configured={feishuConfigured}
          enabled={fs.enabled}
          toggleDisabled={saving}
          onToggle={(next) => void toggleChannelEnabled('feishu', next)}
          onConfigure={() => setFeishuModalOpen(true)}
          onEdit={() => setFeishuModalOpen(true)}
          onRemove={() => setRemoveTarget('feishu')}
          ch={ch}
        />
        <ChannelImHubCard
          icon={<MessageCircle className="size-6 text-accent" strokeWidth={1.75} />}
          title={ch.dingtalkTitle}
          subtitle={ch.dingtalkSubtitle}
          configured={dingtalkConfigured}
          enabled={dt.enabled}
          toggleDisabled={saving}
          onToggle={(next) => void toggleChannelEnabled('dingtalk', next)}
          onConfigure={() => setDingtalkModalOpen(true)}
          onEdit={() => setDingtalkModalOpen(true)}
          onRemove={() => setRemoveTarget('dingtalk')}
          ch={ch}
        />
      </div>

      <WeixinQrLoginDialog
        open={weixinModalOpen}
        onOpenChange={setWeixinModalOpen}
        ch={ch}
        onLoginSuccess={async () => {
          await mutate();
          setWeixinSuccessBanner(ch.weixinQrLoginSuccess);
          window.setTimeout(() => setWeixinSuccessBanner(null), 4000);
        }}
        moreSettings={weixinMoreSettings}
      />

      <TelegramChannelSettingsDialog
        open={telegramModalOpen}
        onOpenChange={setTelegramModalOpen}
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
      />

      <FeishuQrSetupDialog
        open={feishuModalOpen}
        onOpenChange={setFeishuModalOpen}
        ch={ch}
        onSetupSuccess={handleFeishuQrSetupSuccess}
        moreSettings={feishuMoreSettings}
      />

      <DingtalkQrSetupDialog
        open={dingtalkModalOpen}
        onOpenChange={setDingtalkModalOpen}
        ch={ch}
        onSetupSuccess={handleDingtalkQrSetupSuccess}
        moreSettings={dingtalkMoreSettings}
      />

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
