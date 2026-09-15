import { MAX_BROWSER_CONTEXTS_PER_TURN, browserPageContextsInputSchema } from '@xopcai/gateway-contract';

import { t } from '../i18n';
import type { AttachedPageContext } from './page-context';

export function appendPageContext(pages: AttachedPageContext[], page: AttachedPageContext): AttachedPageContext[] {
  const others = pages.filter(item => item.tabId !== page.tabId || Boolean(item.context.selection) !== Boolean(page.context.selection));
  if (others.length >= MAX_BROWSER_CONTEXTS_PER_TURN) throw new Error(t('errorPageLimit', String(MAX_BROWSER_CONTEXTS_PER_TURN)));
  const next = [...others, page];
  if (!browserPageContextsInputSchema.safeParse(next.map(item => item.context)).success) throw new Error(t('errorPageContextSize'));
  return next;
}
