import { ChevronDown } from 'lucide-react';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function ScrollToBottomButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="fixed bottom-28 right-6 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-surface-panel text-fg shadow-md hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-edge md:right-10"
      onClick={onClick}
      title={m.chat.scrollToBottom}
    >
      <ChevronDown className="h-6 w-6" aria-hidden />
    </button>
  );
}
