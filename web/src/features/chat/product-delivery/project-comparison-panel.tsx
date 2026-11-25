import {
  A2UI_VERSION, A2UI_V1_VERSION, PROJECT_COMPARISON_ACTION_PATH, projectComparisonActionResultSchema,
  type ProjectComparison, type ProjectComparisonAction,
} from '@xopcai/gateway-contract';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

const bindingSchema = z.union([
  z.object({ path: z.string() }),
  z.object({ '@path': z.string() }),
]);
const componentSchema = z.discriminatedUnion('component', [
  z.object({ id: z.string(), component: z.literal(['Column', 'Row']), children: z.array(z.string()).max(40) }),
  z.object({ id: z.string(), component: z.literal('Divider') }),
  z.object({
    id: z.string(), component: z.literal('Text'),
    text: z.union([z.string(), bindingSchema]),
    variant: z.enum(['body', 'caption', 'h4', 'h5']).optional(),
  }),
  z.object({
    id: z.string(), component: z.literal('Button'), child: z.string(),
    action: z.object({ event: z.object({
      name: z.literal('inspectProject'),
      context: z.object({ projectId: bindingSchema, status: bindingSchema }),
    }) }),
  }),
]);
const componentsSchema = z.array(componentSchema).max(40);
const dataSchema = z.object({
  selection: z.string(),
  project_0: z.object({ id: z.string(), status: z.string() }).optional(),
  project_1: z.object({ id: z.string(), status: z.string() }).optional(),
  project_2: z.object({ id: z.string(), status: z.string() }).optional(),
  project_3: z.object({ id: z.string(), status: z.string() }).optional(),
});

type Binding = z.infer<typeof bindingSchema>;
type ComparisonComponent = z.infer<typeof componentSchema>;
type Version = ProjectComparisonAction['version'];
type InspectAction = ProjectComparisonAction['action'] & { context: { status: string } };
const patchesBySurface = new Map<string, Map<string, string>>();

function readSurface(comparison: ProjectComparison) {
  const v1 = comparison.messagesV1?.[0].createSurface;
  const components = componentsSchema.parse(v1?.components ?? comparison.messages[1].updateComponents.components);
  const nodes = new Map(components.map(component => [component.id, component]));
  const visited = new Set<string>();
  const pending = ['root'];
  while (pending.length) {
    const id = pending.pop()!;
    const node = nodes.get(id);
    if (!node || visited.has(id)) throw new Error('Invalid project comparison component tree');
    visited.add(id);
    if ('children' in node) pending.push(...node.children);
    if ('child' in node) pending.push(node.child);
  }
  if (visited.size !== components.length) throw new Error('Unreachable project comparison component');

  const { selection, ...projects } = dataSchema.parse(v1?.dataModel ?? comparison.messages[2].updateDataModel.value);
  const values = new Map([['/selection', selection]]);
  for (const [key, project] of Object.entries(projects)) {
    if (!project) continue;
    values.set(`/${key}/id`, project.id);
    values.set(`/${key}/status`, project.status);
  }
  return { nodes, values };
}

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
  version: Version;
  cacheKey: string;
}) {
  const [{ nodes, values }] = useState(() => readSurface(comparison));
  const [patches, setPatches] = useState(() => patchesBySurface.get(cacheKey) ?? new Map<string, string>());
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function submitAction(action: InspectAction) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setFailed(false);
    try {
      const data = await fetchJson<unknown>(apiUrl(PROJECT_COMPARISON_ACTION_PATH), {
        method: 'POST',
        body: JSON.stringify({ version, action }),
        signal: controller.signal,
      });
      const { messages } = projectComparisonActionResultSchema.parse(data);
      if (controller.signal.aborted) return;
      const expectedPaths = new Set(['/selection', `/project_${action.sourceComponentId.slice('inspect_'.length)}/status`]);
      const next = new Map(patches);
      for (const { version: patchVersion, updateDataModel: { surfaceId, path, value } } of messages) {
        if (patchVersion !== version || surfaceId !== comparison.surfaceId || !expectedPaths.delete(path)
          || typeof value !== 'string') throw new Error('Invalid project comparison update');
        next.set(path, value);
      }
      patchesBySurface.delete(cacheKey);
      patchesBySurface.set(cacheKey, next);
      if (patchesBySurface.size > 100) patchesBySurface.delete(patchesBySurface.keys().next().value!);
      setPatches(next);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function resolveText(text: string | Binding): string | undefined {
    if (typeof text === 'string') return text;
    const key = version === A2UI_V1_VERSION && '@path' in text ? text['@path']
      : version === A2UI_VERSION && 'path' in text ? text.path : undefined;
    return key === undefined ? undefined : patches.get(key) ?? values.get(key);
  }

  function renderNode(id: string): ReactNode {
    const node: ComparisonComponent = nodes.get(id)!;
    switch (node.component) {
      case 'Column':
        return <div key={id} className="flex min-w-0 flex-1 flex-col gap-1">{node.children.map(renderNode)}</div>;
      case 'Row':
        return <div key={id} className="flex min-w-0 items-center gap-3">{node.children.map(renderNode)}</div>;
      case 'Divider':
        return <hr key={id} className="my-0.5 border-edge" />;
      case 'Text': {
        const text = resolveText(node.text) ?? '';
        // The v1.0 Basic Catalog represents headings as Markdown in body text.
        if (node.variant === 'h4' || text.startsWith('#### ')) {
          return <h4 key={id} className="wrap-anywhere text-base font-semibold text-fg">{text.replace(/^#### /, '')}</h4>;
        }
        if (node.variant === 'h5' || text.startsWith('##### ')) {
          return <h5 key={id} className="wrap-anywhere text-sm font-semibold text-fg">{text.replace(/^##### /, '')}</h5>;
        }
        return <span key={id} className={node.variant === 'caption' ? 'wrap-anywhere text-xs text-fg-muted' : 'wrap-anywhere text-sm'}>{text}</span>;
      }
      case 'Button': {
        const { event } = node.action;
        const projectId = resolveText(event.context.projectId);
        const status = resolveText(event.context.status);
        return (
          <Button key={id} variant="ghost" className="max-w-[48%] min-h-11 shrink-0 text-accent-fg"
            disabled={!projectId || status === undefined || pending}
            onClick={() => {
              if (!projectId || status === undefined) return;
              void submitAction({ name: event.name, surfaceId: comparison.surfaceId, sourceComponentId: id,
                timestamp: new Date().toISOString(), context: { projectId, status } });
            }}>
            {renderNode(node.child)}
          </Button>
        );
      }
    }
  }

  return (
    <section data-project-comparison={comparison.surfaceId} aria-busy={pending}
      className="w-full max-w-md min-w-0 rounded-xl border border-edge bg-surface-panel px-4 py-3">
      {renderNode('root')}
      {failed && (
        <p role="status" className="text-sm text-fg-muted">
          {language === 'zh' ? '无法更新项目对比。' : 'Could not update the project comparison.'}
        </p>
      )}
    </section>
  );
}
