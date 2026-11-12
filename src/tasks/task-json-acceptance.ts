import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

import type { TaskEvidence, TaskRunReceipt } from '@xopcai/gateway-contract';

import { isPersonalConversation } from '../personal-agent/repository.js';
import { resolveMediaBufferPath } from '../media/store.js';
import { tryParseMediaUri } from '../media/uri.js';
import { assertTaskHandoffAccess, type TaskHandoff } from './task-handoff.js';
import { resolveTaskLocale } from './task-language.js';
import type { TaskAggregate } from './task-repository.js';
import type { inspectTaskPublications } from './task-research-repair.js';

const MAX_JSON_BYTES = 1024 * 1024;
const FILE = '[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}\\.json';
const KEYS = '[A-Za-z_][A-Za-z0-9_]*(?:(?:, *(?:and +)?| +and +| *[、和] *)[A-Za-z_][A-Za-z0-9_]*)*';
const plainRequest = new RegExp(`^(?:Create|Generate) a valid JSON file (?:named|called) (${FILE})[.]?$`, 'i');
const listRequest = new RegExp(`^(?:Create|Generate) a JSON file (?:named|called) (${FILE}) containing exactly (\\d{1,4}) objects?, each with fields? (${KEYS})[.]?$`, 'i');
const plainChineseRequest = new RegExp(`^生成一个名为[ ]*(${FILE})[ ]*的有效[ ]*JSON[ ]*文件[。]?$`);
const listChineseRequest = new RegExp(`^生成一个名为[ ]*(${FILE})[ ]*的[ ]*JSON[ ]*文件，包含[ ]*(\\d{1,4})[ ]*个对象，每个对象都有字段[ ]*(${KEYS})[。]?$`);

export function taskJsonAcceptance(task: TaskAggregate, handoff: TaskHandoff | undefined) {
  const request = handoff?.originalRequest?.trim();
  const contract = task.contract;
  if (!handoff || !request || request.length > 512 || contract?.acceptancePolicy !== 'verified_auto' || contract.resultPolicy !== 'selected'
    || !isPersonalConversation(handoff.conversationId) || task.priority === 'critical'
    || contract.constraints.length || contract.risks.length || contract.approvalRequired.length || contract.assumptions.length
    || contract.outputDestinations.length || handoff.attachments.length || handoff.sources.length || handoff.requestedSources?.length
    || handoff.completeness.unresolvedReferences.length || handoff.completeness.omitted.length || handoff.conversationExcerpts?.length
    || contract.brief?.trim() !== request) return undefined;
  try { assertTaskHandoffAccess(handoff); } catch { return undefined; }

  // Match the entire original request. Free-form content stays on the regular verification path.
  const list = listRequest.exec(request) ?? listChineseRequest.exec(request);
  const match = list ?? plainRequest.exec(request) ?? plainChineseRequest.exec(request);
  if (!match) return undefined;
  const file = match[1];
  const count = list ? Number(list[2]) : undefined;
  const fields = list ? [...new Set(list[3].split(/, *(?:and +)?| +and +| *[、和] */i))] : [];
  if (fields.length > 20) return undefined;
  const zh = resolveTaskLocale(task) === 'zh';
  return {
    file, count, fields,
    criteria: [
      zh ? `交付有效的 JSON 文件 ${file}。` : `Deliver a valid JSON file named ${file}.`,
      ...(count === undefined ? [] : [
        zh ? `JSON 数组恰好包含 ${count} 个对象。` : `The JSON array contains exactly ${count} objects.`,
        zh ? `每个对象都有字段 ${fields.join(', ')}。` : `Each object has the fields ${fields.join(', ')}.`,
      ]),
    ],
  };
}

export function currentTaskJsonAcceptance(task: TaskAggregate, handoff: TaskHandoff | undefined) {
  const spec = taskJsonAcceptance(task, handoff);
  return spec && JSON.stringify(task.contract?.acceptanceCriteria) === JSON.stringify(spec.criteria)
    && task.contract?.expectedOutputs.length === 1 && task.contract.expectedOutputs[0] === spec.file ? spec : undefined;
}

export function verifyTaskJsonPublication(spec: NonNullable<ReturnType<typeof taskJsonAcceptance>>,
  item: ReturnType<typeof inspectTaskPublications>['latestPublishedArtifacts'][number], zh: boolean): {
    sha256: string; evidence: TaskEvidence; checks: TaskRunReceipt['verification']['checks']; summary: string;
  } | undefined {
  const media = item.uri && tryParseMediaUri(item.uri);
  if (!media || media.bucket !== 'outbound' || item.title !== spec.file || !item.capabilities.includes('download')) return undefined;
  let fd: number | undefined;
  let buffer: Buffer;
  let value: unknown;
  try {
    fd = openSync(resolveMediaBufferPath(media.id, media.bucket), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) return undefined;
    buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length !== stat.size) return undefined;
    buffer = buffer.subarray(0, length);
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }

  if (spec.count !== undefined && (!Array.isArray(value) || value.length !== spec.count
    || !value.every(record => record && typeof record === 'object' && !Array.isArray(record)
      && spec.fields.every(field => Object.hasOwn(record, field))))) return undefined;

  const title = zh ? 'JSON 文件结构检查' : 'JSON file structure check';
  const summary = spec.count === undefined
    ? zh ? 'JSON 文件格式已核验。' : 'The JSON file format is verified.'
    : zh ? `已核验 JSON 文件格式、${spec.count} 个对象和必填字段。` : `Verified the JSON format, ${spec.count} objects, and the required fields.`;
  return { sha256: createHash('sha256').update(buffer).digest('hex'), summary,
    evidence: { kind: 'artifact', title, summary, uri: item.uri, verifies: spec.criteria,
      provenance: 'tool', strength: 'verified', observedAt: Date.now() },
    checks: spec.criteria.map(criterion => ({ criterion, status: 'passed', evidenceTitles: [title], method: 'tool_verified' })),
  };
}
