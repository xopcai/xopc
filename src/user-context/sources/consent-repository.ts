import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { PERSONAL_DOMAINS } from '../../user-model/domain.js';
import type { UnderstandingConsentReceipt } from './types.js';

const CONSENT_FIELDS = new Set([
  'title', 'content', 'participants', 'status', 'timestamps', 'owner_activity',
]);

type ConsentRow = {
  receipt_id: string;
  grant_id: string;
  purposes_json: string;
  allowed_domains_json: string;
  denied_domains_json: string;
  allowed_fields_json: string;
  access_mode: UnderstandingConsentReceipt['accessMode'];
  lookback_days: number;
  raw_retention_days: number;
  processing_policy: UnderstandingConsentReceipt['processingPolicy'];
  allowed_agent_ids_json: string | null;
  disclosure_version: string;
  granted_at: number;
  revoked_at: number | null;
};

function strings(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function fromRow(row: ConsentRow): UnderstandingConsentReceipt {
  return {
    id: row.receipt_id,
    grantId: row.grant_id,
    purposes: strings(row.purposes_json),
    allowedDomains: strings(row.allowed_domains_json),
    deniedDomains: strings(row.denied_domains_json),
    allowedFields: strings(row.allowed_fields_json),
    accessMode: row.access_mode,
    lookbackDays: row.lookback_days,
    rawRetentionDays: row.raw_retention_days,
    processingPolicy: row.processing_policy,
    ...(row.allowed_agent_ids_json ? { allowedAgentIds: strings(row.allowed_agent_ids_json) } : {}),
    disclosureVersion: row.disclosure_version,
    grantedAt: row.granted_at,
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}

function normalized(values: string[], field: string): string[] {
  const result = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!result.length) throw new Error(`${field} must contain at least one value.`);
  return result;
}

export function grantUnderstandingConsent(input: Omit<UnderstandingConsentReceipt, 'id' | 'grantedAt' | 'revokedAt'> & {
  nowMs?: number;
}): UnderstandingConsentReceipt {
  if (!Number.isInteger(input.lookbackDays) || input.lookbackDays < 0) throw new Error('lookbackDays must be a non-negative integer.');
  if (!Number.isInteger(input.rawRetentionDays) || input.rawRetentionDays < 0) throw new Error('rawRetentionDays must be a non-negative integer.');
  const purposes = normalized(input.purposes, 'purposes');
  const allowedDomains = normalized(input.allowedDomains, 'allowedDomains');
  const allowedFields = normalized(input.allowedFields, 'allowedFields');
  const deniedDomains = [...new Set(input.deniedDomains.map((value) => value.trim()).filter(Boolean))];
  if ([...allowedDomains, ...deniedDomains].some((domain) => !PERSONAL_DOMAINS.includes(domain as typeof PERSONAL_DOMAINS[number]))) {
    throw new Error('Consent domains must use the personal-model domain vocabulary.');
  }
  if (allowedDomains.some((domain) => deniedDomains.includes(domain))) {
    throw new Error('A domain cannot be both allowed and denied.');
  }
  if (allowedFields.some((field) => !CONSENT_FIELDS.has(field))) {
    throw new Error('Consent fields must use the supported source-field vocabulary.');
  }
  const receiptId = randomUUID();
  const now = input.nowMs ?? Date.now();
  if (!input.disclosureVersion.trim()) throw new Error('disclosureVersion is required.');
  runSqliteWriteTransaction((db) => {
    const grant = db.prepare('SELECT status FROM understanding_source_grants WHERE grant_id = ?')
      .get(input.grantId) as { status: string } | undefined;
    if (!grant || grant.status !== 'active') throw new Error('Consent requires an active understanding source grant.');
    db.prepare('UPDATE understanding_consent_receipts SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL')
      .run(now, input.grantId);
    db.prepare(`INSERT INTO understanding_consent_receipts (
      receipt_id, grant_id, purposes_json, allowed_domains_json, denied_domains_json,
      allowed_fields_json, access_mode, lookback_days, raw_retention_days, processing_policy,
      allowed_agent_ids_json, disclosure_version, granted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      receiptId, input.grantId, JSON.stringify(purposes), JSON.stringify(allowedDomains),
      JSON.stringify(deniedDomains), JSON.stringify(allowedFields), input.accessMode,
      input.lookbackDays, input.rawRetentionDays, input.processingPolicy,
      input.allowedAgentIds ? JSON.stringify(normalized(input.allowedAgentIds, 'allowedAgentIds')) : null,
      input.disclosureVersion.trim(), now,
    );
  });
  return getUnderstandingConsent(receiptId)!;
}

export function getUnderstandingConsent(id: string): UnderstandingConsentReceipt | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM understanding_consent_receipts WHERE receipt_id = ?')
    .get(id) as ConsentRow | undefined;
  return row ? fromRow(row) : null;
}

export function getActiveUnderstandingConsent(grantId: string): UnderstandingConsentReceipt | null {
  const row = getSqliteDatabase().prepare(`SELECT * FROM understanding_consent_receipts
    WHERE grant_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC LIMIT 1`)
    .get(grantId) as ConsentRow | undefined;
  return row ? fromRow(row) : null;
}

export function revokeUnderstandingConsent(grantId: string, nowMs = Date.now()): number {
  return Number(getSqliteDatabase().prepare(`UPDATE understanding_consent_receipts
    SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL`).run(nowMs, grantId).changes);
}
