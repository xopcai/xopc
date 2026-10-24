import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';

const setupTargets = {
  phone: {
    scene: 'configure-phone',
    zh: '帮我配置 Phone Use，从模型、依赖、手机连接到验收。',
    en: 'Help configure Phone Use: model, dependencies, phone connection and verification.',
  },
  browser: {
    scene: 'configure-xopc',
    zh: '帮我配置 Browser Use，连接本机 Chrome 并完成验收。',
    en: 'Help me configure Browser Use with local Chrome and verify it.',
  },
} as const;

export type SettingsAiSetupTarget = keyof typeof setupTargets;

/** Shared entry point for settings supported by the built-in configuration skill. */
export function SettingsAiSetupAction({ target }: { target: SettingsAiSetupTarget }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const setup = setupTargets[target];
  const params = new URLSearchParams({
    skill: 'configure-xopc', scene: setup.scene, draft: zh ? setup.zh : setup.en, autoSend: '1',
  });
  return <Button asChild className="order-first whitespace-nowrap sm:order-last text-accent-fg shadow-none sm:shadow-none">
    <Link to={`/chat/new?${params}`} title={zh ? '让 AI 帮我配置' : 'Set up with AI'}>
      <Sparkles className="size-4 shrink-0" aria-hidden />
      {zh ? 'AI 配置' : 'AI setup'}
    </Link>
  </Button>;
}
