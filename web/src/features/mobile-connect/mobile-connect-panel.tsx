import {
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Globe2,
  HouseWifi,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { MobilePairQrSection } from '@/features/tunnel/mobile-pair-qr-section';
import { TunnelSettingsPanel } from '@/features/tunnel/tunnel-settings';
import { useMobilePairQr } from '@/features/tunnel/use-mobile-pair-qr';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type Step = 'install' | 'network' | 'pair' | 'done';
type ConnectMode = 'lan' | 'remote';

const STEP_ORDER: Step[] = ['install', 'network', 'pair', 'done'];

function StepProgress({ step }: { step: Step }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).mobileConnect;
  const current = STEP_ORDER.indexOf(step);

  return (
    <ol className="grid grid-cols-4 gap-2" aria-label={t.title}>
      {STEP_ORDER.map((item, index) => {
        const complete = index < current;
        const active = index === current;
        return (
          <li key={item} className="min-w-0">
            <div className={cn('h-1 rounded-full', index <= current ? 'bg-accent' : 'bg-surface-hover')} />
            <div className={cn('mt-2 flex items-center gap-1.5 text-xs', active ? 'font-medium text-fg' : 'text-fg-subtle')}>
              <span className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                complete && 'border-success bg-success-soft text-success',
                active && 'border-accent bg-accent-soft text-accent-fg',
                !complete && !active && 'border-edge text-fg-subtle',
              )}>
                {complete ? <Check className="size-3" aria-hidden /> : index + 1}
              </span>
              <span className="hidden truncate sm:block">{t.steps[item]}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ModeCard({
  icon: Icon,
  title,
  body,
  badge,
  onClick,
}: {
  icon: typeof HouseWifi;
  title: string;
  body: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex min-h-44 flex-col rounded-2xl border border-edge bg-surface-base p-5 text-left shadow-surface',
        'transition-colors hover:border-accent/40 hover:bg-surface-hover/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-fg">{title}</span>
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">{badge}</span>
      </span>
      <span className="mt-2 text-sm leading-6 text-fg-muted">{body}</span>
      <ChevronRight className="mt-auto size-4 self-end text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  );
}

export function MobileConnectPanel() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).mobileConnect;
  const token = useGatewayStore((s) => s.token) ?? '';
  const [step, setStep] = useState<Step>('install');
  const [mode, setMode] = useState<ConnectMode>('lan');
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const pairQr = useMobilePairQr(token, { preferLan: mode === 'lan' });

  useEffect(() => {
    const onCompleted = (event: Event) => {
      const detail = (event as CustomEvent<{ pairingSessionId?: string | null; connectedAt?: string }>).detail;
      if (!detail?.pairingSessionId || detail.pairingSessionId !== pairQr.pairingSessionId) return;
      setConnectedAt(detail.connectedAt ?? new Date().toISOString());
      setStep('done');
    };
    window.addEventListener('mobile-pairing-completed', onCompleted);
    return () => window.removeEventListener('mobile-pairing-completed', onCompleted);
  }, [pairQr.pairingSessionId]);

  const connectedTime = useMemo(() => {
    if (!connectedAt) return '';
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(connectedAt));
  }, [connectedAt, language]);

  const chooseMode = (next: ConnectMode) => {
    setMode(next);
    setConnectedAt(null);
    setStep('pair');
  };

  const reset = () => {
    setConnectedAt(null);
    setStep('network');
    void pairQr.refreshQr();
  };

  if (!token) {
    return (
      <SettingsPageFrame>
        <SettingsPageHeader title={t.title} subtitle={t.subtitle} />
        <p className="text-sm text-fg-muted">{t.needToken}</p>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader title={t.title} subtitle={t.subtitle} />
      <StepProgress step={step} />

      {step === 'install' ? (
        <SettingsFormSection className="overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[1fr_18rem]">
            <div className="p-6 sm:p-8">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-fg">
                <Smartphone className="size-6" strokeWidth={1.75} aria-hidden />
              </span>
              <h2 className="mt-5 text-xl font-semibold text-fg">{t.installTitle}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-fg-muted">{t.installBody}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button asChild>
                  <a href="https://xopc.ai" target="_blank" rel="noreferrer">
                    <Download className="size-4" aria-hidden />
                    {t.download}
                  </a>
                </Button>
                <Button variant="primary" onClick={() => setStep('network')}>
                  {t.installed}
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            <div className="flex min-h-52 items-center justify-center bg-surface-hover/60 p-8">
              <div className="relative flex h-44 w-24 items-center justify-center rounded-[1.75rem] border-4 border-fg/80 bg-surface-base shadow-lg">
                <div className="absolute top-2 h-1.5 w-8 rounded-full bg-fg/30" />
                <Smartphone className="size-10 text-accent" strokeWidth={1.4} aria-hidden />
              </div>
            </div>
          </div>
        </SettingsFormSection>
      ) : null}

      {step === 'network' ? (
        <div>
          <h2 className="text-lg font-semibold text-fg">{t.networkTitle}</h2>
          <p className="mt-1 text-sm text-fg-muted">{t.networkBody}</p>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <ModeCard icon={HouseWifi} title={t.lanTitle} body={t.lanBody} badge={t.lanBadge} onClick={() => chooseMode('lan')} />
            <ModeCard icon={Globe2} title={t.remoteTitle} body={t.remoteBody} badge={t.remoteBadge} onClick={() => chooseMode('remote')} />
          </div>
          <Button variant="ghost" className="mt-4" onClick={() => setStep('install')}>{t.back}</Button>
        </div>
      ) : null}

      {step === 'pair' ? (
        <div className="space-y-4">
          <SettingsFormSection className="border border-accent/20 bg-accent-soft/30">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
                {mode === 'lan' ? <HouseWifi className="size-4" aria-hidden /> : <Globe2 className="size-4" aria-hidden />}
              </span>
              <div>
                <h2 className="text-base font-semibold text-fg">{t.pairTitle}</h2>
                <p className="mt-1 text-sm leading-6 text-fg-muted">{mode === 'lan' ? t.pairBodyLan : t.pairBodyRemote}</p>
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-accent-fg">
                  <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden />
                  {t.waiting}
                </div>
                <p className="mt-1 text-xs text-fg-subtle">{t.waitingHint}</p>
              </div>
            </div>
          </SettingsFormSection>

          {mode === 'lan' ? (
            <MobilePairQrSection
              pairQr={pairQr}
              gatewayToken={token}
              lanOnly
              onRefreshQr={() => void pairQr.refreshQr()}
            />
          ) : (
            <TunnelSettingsPanel embedded />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setStep('network')}>{t.back}</Button>
            <Button asChild variant="ghost">
              <Link to="/settings/remote-access">{t.advanced}</Link>
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'done' ? (
        <SettingsFormSection className="py-10 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="size-7" strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className="mt-5 text-xl font-semibold text-fg">{t.successTitle}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-fg-muted">{t.successBody}</p>
          {connectedTime ? (
            <p className="mt-2 text-xs text-fg-subtle">{t.successTime.replace('{{time}}', connectedTime)}</p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild variant="primary">
              <Link to="/chat">{t.finish}</Link>
            </Button>
            <Button onClick={reset}>
              <Smartphone className="size-4" aria-hidden />
              {t.connectAnother}
            </Button>
          </div>
          <div className="mx-auto mt-6 flex max-w-md items-center justify-center gap-2 rounded-xl bg-surface-hover/60 px-3 py-2 text-xs text-fg-muted">
            <ShieldCheck className="size-4 text-success" aria-hidden />
            {t.waitingHint}
          </div>
        </SettingsFormSection>
      ) : null}
    </SettingsPageFrame>
  );
}
