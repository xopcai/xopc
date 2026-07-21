import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_SCENARIOS = 10;
const MAX_STEPS = 20;
const MAX_TEXT_LENGTH = 500;
const TEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export type LocalAppAcceptanceStep =
  | { action: 'click'; target: string }
  | { action: 'fill'; target: string; value: string }
  | { assert: 'text_visible'; text: string }
  | { assert: 'element_exists'; target: string }
  | { assert: 'value_equals'; target: string; value: string };

export interface LocalAppAcceptanceScenario {
  id: string;
  name: string;
  steps: LocalAppAcceptanceStep[];
}

export interface LocalAppAcceptanceConfig {
  schemaVersion: 1;
  scenarios: LocalAppAcceptanceScenario[];
}

function requiredText(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string up to ${maxLength} characters`);
  }
  return value;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} must be a string up to ${MAX_TEXT_LENGTH} characters`);
  }
  return value;
}

function testId(value: unknown, label: string): string {
  const id = requiredText(value, label, 80);
  if (!TEST_ID_PATTERN.test(id)) {
    throw new Error(`${label} must use only letters, numbers, dashes, and underscores`);
  }
  return id;
}

function parseStep(value: unknown, label: string): LocalAppAcceptanceStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const step = value as Record<string, unknown>;
  const hasOnly = (...keys: string[]) => Object.keys(step).every((key) => keys.includes(key));
  if (step.action === 'click' && hasOnly('action', 'target')) {
    return { action: 'click', target: testId(step.target, `${label}.target`) };
  }
  if (step.action === 'fill' && hasOnly('action', 'target', 'value')) {
    return { action: 'fill', target: testId(step.target, `${label}.target`), value: boundedText(step.value, `${label}.value`) };
  }
  if (step.assert === 'text_visible' && hasOnly('assert', 'text')) {
    return { assert: 'text_visible', text: requiredText(step.text, `${label}.text`) };
  }
  if (step.assert === 'element_exists' && hasOnly('assert', 'target')) {
    return { assert: 'element_exists', target: testId(step.target, `${label}.target`) };
  }
  if (step.assert === 'value_equals' && hasOnly('assert', 'target', 'value')) {
    return { assert: 'value_equals', target: testId(step.target, `${label}.target`), value: boundedText(step.value, `${label}.value`) };
  }
  throw new Error(`${label} uses an unsupported action or assertion`);
}

export function parseLocalAppAcceptanceConfig(value: unknown): LocalAppAcceptanceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Acceptance config must be an object');
  const config = value as Record<string, unknown>;
  if (config.schemaVersion !== 1) throw new Error('Acceptance config schemaVersion must be 1');
  if (!Array.isArray(config.scenarios) || config.scenarios.length > MAX_SCENARIOS) {
    throw new Error(`Acceptance config must contain at most ${MAX_SCENARIOS} scenarios`);
  }
  const ids = new Set<string>();
  const scenarios = config.scenarios.map((value, scenarioIndex) => {
    const label = `Acceptance scenario ${scenarioIndex + 1}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    const scenario = value as Record<string, unknown>;
    const id = testId(scenario.id, `${label}.id`);
    if (ids.has(id)) throw new Error(`Acceptance scenario id is duplicated: ${id}`);
    ids.add(id);
    if (!Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length > MAX_STEPS) {
      throw new Error(`${label} must contain 1 to ${MAX_STEPS} steps`);
    }
    return {
      id,
      name: requiredText(scenario.name, `${label}.name`, 120),
      steps: scenario.steps.map((step, stepIndex) => parseStep(step, `${label} step ${stepIndex + 1}`)),
    };
  });
  return { schemaVersion: 1, scenarios };
}

export function readLocalAppAcceptanceConfig(root: string): LocalAppAcceptanceConfig {
  const path = join(root, '.xopc', 'acceptance.json');
  if (!existsSync(path)) return { schemaVersion: 1, scenarios: [] };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Acceptance config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseLocalAppAcceptanceConfig(value);
}

export function encodeLocalAppAcceptanceConfig(config: LocalAppAcceptanceConfig): string {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64url');
}
