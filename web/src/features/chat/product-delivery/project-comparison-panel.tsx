import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react';
import { MessageProcessor, type OutboundActionMessage } from '@a2ui/web_core';
import { basicCatalog as basicCatalogV1, injectBasicCatalogStyles } from '@a2ui/web_core/catalogs/basic/v1';
import { basicCatalog as legacyBasicCatalog } from '@a2ui/web_core/v0_9/basic_catalog';
import {
  A2UI_VERSION, A2UI_V1_VERSION, PROJECT_COMPARISON_ACTION_PATH, projectComparisonActionResultSchema, type ProjectComparison,
  type ProjectComparisonAction,
} from '@xopcai/gateway-contract';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import './project-comparison-panel.css';

type ComparisonPatch = ReturnType<typeof projectComparisonActionResultSchema.parse>['messages'][number];
const patchesBySurface = new Map<string, Map<string, ComparisonPatch>>();

type ProjectComparisonPanelProps = {
  comparison: ProjectComparison;
  language: 'en' | 'zh';
};

export function ProjectComparisonPanel(props: ProjectComparisonPanelProps) {
  const version = props.comparison.messagesV1 ? A2UI_V1_VERSION : A2UI_VERSION;
  const cacheKey = `${version}:${props.comparison.surfaceId}`;
  return <ComparisonSurface key={cacheKey} {...props} version={version} cacheKey={cacheKey} />;
}

function ComparisonSurface({ comparison, language, version, cacheKey }: ProjectComparisonPanelProps & {
  version: ProjectComparisonAction['version'];
  cacheKey: string;
}) {
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController>(null);
  const actionReceiver = useRef<(message: OutboundActionMessage) => void>(null);
  const [processor] = useState(() => {
    const catalog = version === A2UI_V1_VERSION ? basicCatalogV1 : legacyBasicCatalog;
    const instance = new MessageProcessor<ReactCatalogComponent>([catalog], undefined, {
      unifiedOutbound: true,
      outboundListener: message => {
        if ('action' in message) actionReceiver.current?.(message);
      },
    });
    const messages = comparison.messagesV1 ?? comparison.messages;
    if (instance.processMessagesWithErrors(messages).length) throw new Error('Invalid A2UI surface');
    for (const patch of patchesBySurface.get(cacheKey)?.values() ?? []) {
      instance.processMessagesWithErrors(patch);
    }
    return instance;
  });
  const surface = processor.getSurfaces().get(comparison.surfaceId);

  const submitAction = useEffectEvent(async (message: OutboundActionMessage) => {
    const { action } = message;
    if (request.current || message.version !== version || action.name !== 'inspectProject'
      || action.surfaceId !== comparison.surfaceId) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setFailed(false);
    try {
      const data = await fetchJson<unknown>(apiUrl(PROJECT_COMPARISON_ACTION_PATH), {
        method: 'POST',
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      const { messages } = projectComparisonActionResultSchema.parse(data);
      if (controller.signal.aborted) return;
      if (messages.some(patch => patch.version !== version || patch.updateDataModel.surfaceId !== comparison.surfaceId)
        || processor.processMessagesWithErrors(messages).length) throw new Error('Invalid A2UI patch');
      const cache = patchesBySurface.get(cacheKey) ?? new Map<string, ComparisonPatch>();
      for (const patch of messages) cache.set(patch.updateDataModel.path, patch);
      patchesBySurface.delete(cacheKey);
      patchesBySurface.set(cacheKey, cache);
      if (patchesBySurface.size > 100) patchesBySurface.delete(patchesBySurface.keys().next().value!);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  });

  useEffect(() => {
    injectBasicCatalogStyles();
    actionReceiver.current = message => { void submitAction(message); };
    return () => {
      actionReceiver.current = null;
      request.current?.abort();
    };
  }, []);

  return (
    <section data-project-comparison={comparison.surfaceId} aria-busy={pending}
      className="project-comparison-panel w-full max-w-md min-w-0 rounded-xl border border-edge bg-surface-panel px-4 py-3">
      {surface && <A2uiSurface surface={surface} />}
      {(!surface || failed) && (
        <p role="status" className="text-sm text-fg-muted">
          {language === 'zh' ? '无法更新项目对比。' : 'Could not update the project comparison.'}
        </p>
      )}
    </section>
  );
}
