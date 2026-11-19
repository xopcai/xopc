import { randomUUID } from 'node:crypto';

import {
  A2UI_VERSION,
  PROJECT_COMPARISON_CATALOG,
  PRODUCT_DELIVERY_VERSION,
  type ProductDeliveryEnvelope,
  type ProjectComparisonAction,
  type ProjectComparisonActionResult,
  type ProjectRecordSchema,
} from '@xopcai/gateway-contract';
import type { z } from 'zod';

type Project = z.infer<typeof ProjectRecordSchema>;

function statusText(project: Project): string {
  return project.health === 'unknown' ? project.status : `${project.status} · ${project.health.replaceAll('_', ' ')}`;
}

export function buildProjectComparison(projects: Project[]): ProductDeliveryEnvelope {
  const surfaceId = `comparison_${randomUUID()}`;
  const rows = projects.flatMap((_, index) => [`separator_${index}`, `row_${index}`]);
  const components: NonNullable<ProductDeliveryEnvelope['projectComparison']>['messages'][1]['updateComponents']['components'] = [
    { id: 'root', component: 'Column', align: 'start', children: ['title', ...rows, 'separator_selection', 'selection'] },
    { id: 'title', component: 'Text', variant: 'h4', text: 'Project comparison' },
    { id: 'separator_selection', component: 'Divider', axis: 'horizontal' },
    { id: 'selection', component: 'Text', variant: 'caption', text: { path: '/selection' } },
  ];
  const data: Record<string, string | { id: string; status: string }> = { selection: 'Select a project to inspect' };
  for (const [index, project] of projects.entries()) {
    const key = `project_${index}`;
    data[key] = { id: project.id, status: statusText(project) };
    components.push(
      { id: `separator_${index}`, component: 'Divider', axis: 'horizontal' },
      { id: `row_${index}`, component: 'Row', align: 'center', children: [key, `inspect_${index}`] },
      { id: key, component: 'Column', weight: 1, align: 'start', children: [`name_${index}`, `status_${index}`] },
      { id: `name_${index}`, component: 'Text', variant: 'h5', text: project.name.slice(0, 200) },
      { id: `status_${index}`, component: 'Text', variant: 'caption', text: { path: `/${key}/status` } },
      { id: `label_${index}`, component: 'Text', text: `Inspect ${project.name.slice(0, 120)}` },
      { id: `inspect_${index}`, component: 'Button', variant: 'borderless', child: `label_${index}`,
        action: { event: { name: 'inspectProject', context: {
          projectId: { path: `/${key}/id` }, status: { path: `/${key}/status` },
        } } } },
    );
  }
  return {
    version: PRODUCT_DELIVERY_VERSION,
    operation: 'opened',
    related: projects.map(project => ({ kind: 'project', id: project.id, title: project.name, status: project.status, capabilities: ['open'] })),
    projectComparison: {
      surfaceId,
      messages: [
        { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: PROJECT_COMPARISON_CATALOG } },
        { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
        { version: A2UI_VERSION, updateDataModel: { surfaceId, path: '/', value: data } },
      ],
    },
  };
}

export function inspectProjectComparison(
  { action }: ProjectComparisonAction,
  project: Project,
): ProjectComparisonActionResult {
  const { surfaceId, sourceComponentId } = action;
  const index = sourceComponentId.slice('inspect_'.length);
  const status = statusText(project);
  const summary = typeof project.description === 'string' ? project.description.trim().slice(0, 180) : undefined;
  return {
    messages: [
      { version: A2UI_VERSION, updateDataModel: { surfaceId, path: `/project_${index}/status`, value: status } },
      { version: A2UI_VERSION, updateDataModel: { surfaceId, path: '/selection',
        value: [`Selected ${project.name.slice(0, 200)}`, status, summary].filter(Boolean).join(' · ') } },
    ],
  };
}
