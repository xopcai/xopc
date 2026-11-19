import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react';
import { basicCatalog, injectBasicCatalogStyles, MessageProcessor, type ActionPayload } from '@a2ui/web_core/v0_9';
import {
  A2UI_VERSION, PROJECT_COMPARISON_ACTION_PATH, projectComparisonActionResultSchema, type ProjectComparison,
} from '@xopcai/gateway-contract';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import './project-comparison-panel.css';

const patchesBySurface = new Map<string, Map<string, unknown>>();

export function ProjectComparisonPanel({ comparison, language }: {
  comparison: ProjectComparison;
  language: 'en' | 'zh';
}) {
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController>(null);
  const actionReceiver = useRef<(action: ActionPayload) => void>(null);
  const [processor] = useState(() => {
    const instance = new MessageProcessor<ReactCatalogComponent>([basicCatalog], action => actionReceiver.current?.(action));
    if (instance.processMessagesWithErrors(comparison.messages).length) throw new Error('Invalid A2UI surface');
    for (const patch of patchesBySurface.get(comparison.surfaceId)?.values() ?? []) {
      instance.processMessagesWithErrors(patch);
    }
    return instance;
  });
  const surface = processor.getSurfaces().get(comparison.surfaceId);

  const submitAction = useEffectEvent(async (action: ActionPayload) => {
    if (request.current || action.surfaceId !== comparison.surfaceId) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setFailed(false);
    try {
      const data = await fetchJson<unknown>(apiUrl(PROJECT_COMPARISON_ACTION_PATH), {
        method: 'POST',
        body: JSON.stringify({ version: A2UI_VERSION, action }),
        signal: controller.signal,
      });
      const { messages } = projectComparisonActionResultSchema.parse(data);
      if (controller.signal.aborted) return;
      if (messages.some(message => message.updateDataModel.surfaceId !== comparison.surfaceId)
        || processor.processMessagesWithErrors(messages).length) throw new Error('Invalid A2UI patch');
      const cache = patchesBySurface.get(comparison.surfaceId) ?? new Map<string, unknown>();
      for (const message of messages) cache.set(message.updateDataModel.path, message);
      patchesBySurface.delete(comparison.surfaceId);
      patchesBySurface.set(comparison.surfaceId, cache);
      if (patchesBySurface.size > 100) patchesBySurface.delete(patchesBySurface.keys().next().value!);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  });

  useEffect(() => {
    injectBasicCatalogStyles();
    actionReceiver.current = action => { void submitAction(action); };
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
