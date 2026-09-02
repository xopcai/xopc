import { readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';
import {
  turnOutcomeKindFromFileName,
  turnOutcomeMimeTypeFromFileName,
  type TurnOutcomeDeliverable,
} from '@xopcai/gateway-contract';

import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import { persistToolMedia } from './tool-media.js';
import { resolvePathUnderWorkspace } from './tool-paths.js';

const PublishArtifactsSchema = Type.Object({
  paths: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    maxItems: 50,
    description: 'Files to publish. Relative paths resolve under the current agent workspace.',
  }),
});

type PublishArtifactsParams = { paths: string[] };
type PublishArtifactsDetails = { artifacts: TurnOutcomeDeliverable[] };

export async function publishArtifactPaths(params: {
  paths: string[];
  baseDir: string;
  toolCallId: string;
}): Promise<TurnOutcomeDeliverable[]> {
  const paths = [...new Set(params.paths.map((value) => value.trim()).filter(Boolean))];
  const artifacts: TurnOutcomeDeliverable[] = [];
  const publishedPaths = new Set<string>();

  for (const [index, inputPath] of paths.entries()) {
    const resolved = resolvePathUnderWorkspace(inputPath, params.baseDir);
    if (publishedPaths.has(resolved)) continue;
    publishedPaths.add(resolved);
    try {
      const policy = evaluateFilePolicy({
        operation: 'read',
        path: resolved,
        workspaceRoot: params.baseDir,
      });
      if (!policy.allowed) throw new Error(policy.reason);
      const buffer = await readFile(policy.canonicalPath ?? resolved);
      const media = await persistToolMedia({ buffer, filePath: resolved });
      const kind = turnOutcomeKindFromFileName(media.name);
      artifacts.push({
        artifactId: media.id,
        title: media.name,
        kind,
        mimeType: media.mimeType,
        sizeBytes: media.size,
        availability: 'available',
        location: 'artifact_store',
        capabilities: kind === 'archive' || kind === 'file'
          ? ['download']
          : ['preview', 'download'],
        uri: media.uri,
      });
    } catch {
      const title = basename(resolved);
      const mimeType = turnOutcomeMimeTypeFromFileName(title);
      artifacts.push({
        artifactId: `publish-failed:${params.toolCallId}:${index}`,
        title,
        kind: turnOutcomeKindFromFileName(title),
        ...(mimeType ? { mimeType } : {}),
        availability: 'failed',
        location: isAbsolute(inputPath) ? 'external_host' : 'workspace',
        capabilities: ['regenerate'],
      });
    }
  }

  return artifacts;
}

export function createPublishArtifactsTool(workspace: string): AgentTool {
  return {
    name: 'publish_artifacts',
    label: 'Publish Artifacts',
    description:
      'Publish completed user-facing files into durable chat artifacts. Call this after exec_command or another runtime creates spreadsheets, presentations, PDFs, documents, archives, or other files. Pass every final deliverable together; do not publish temporary or source files.',
    parameters: PublishArtifactsSchema,
    mutationScope: 'none',
    supportsParallel: false,
    idempotent: false,

    async execute(
      toolCallId: string,
      params: PublishArtifactsParams,
    ): Promise<AgentToolResult<PublishArtifactsDetails>> {
      const paths = [...new Set(params.paths.map((value) => value.trim()).filter(Boolean))];
      if (paths.length === 0) throw new Error('At least one artifact path is required');

      const artifacts = await publishArtifactPaths({ paths, baseDir: workspace, toolCallId });

      const publishedCount = artifacts.filter((item) => item.availability === 'available').length;
      const failedCount = artifacts.length - publishedCount;

      return {
        content: [{
          type: 'text',
          text: [
            `${publishedCount} artifact${publishedCount === 1 ? '' : 's'} published`,
            failedCount > 0 ? `${failedCount} failed` : '',
            artifacts.map((item) => item.title).join(', '),
          ].filter(Boolean).join(': '),
        }],
        details: { artifacts },
      };
    },
  } as AgentTool;
}
