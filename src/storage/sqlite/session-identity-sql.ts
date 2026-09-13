import { SESSION_SOURCE_CHANNELS } from '@xopcai/gateway-contract';

// Keep these CASE expressions aligned with resolveSessionIdentity; repository tests
// verify the same fixtures through both paths. Values here are static, never query input.
const custom = (key: string) => `json_extract(CASE WHEN json_valid(s.custom_data_json) THEN s.custom_data_json ELSE '{}' END, '$.${key}')`;
const channel = 'LOWER(TRIM(s.source_channel))';

export const SESSION_SOURCE_SQL = `(CASE
  WHEN s.session_type = 'heartbeat' THEN 'system'
  WHEN ${custom('origin')} = 'automation' OR ${custom('triggerSource')} = 'automation' OR s.session_type = 'cron' THEN 'automation'
  WHEN ${custom('createdSurface')} = 'browser_extension' THEN 'browser'
  ${Object.entries(SESSION_SOURCE_CHANNELS).map(([name, aliases]) =>
    `WHEN ${channel} IN (${aliases.map((alias) => `'${alias}'`).join(',')}) THEN '${name}'`).join('\n  ')}
  ELSE 'other' END)`;

export const SESSION_PURPOSE_SQL = `(CASE
  WHEN ${SESSION_SOURCE_SQL} = 'system' THEN 'system'
  WHEN s.session_type = 'workflow-subagent' THEN 'subagent'
  WHEN s.session_type = 'workflow-run' THEN 'workflow'
  WHEN ${SESSION_SOURCE_SQL} = 'automation' THEN 'automation'
  ELSE 'chat' END)`;
