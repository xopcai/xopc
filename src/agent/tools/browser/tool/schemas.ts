import type { BrowserActionInput } from '@xopcai/browser-control-contract';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ApprovalId = Type.Optional(Type.String({ description: 'One-time local-owner approval id for this exact action.' }));
const SessionId = Type.Optional(Type.String({ description: 'Browser session id returned by the previous observation.' }));
const Revision = Type.Number({ description: 'Observation revision used to resolve element refs.' });
const Ref = Type.String({ minLength: 1, description: 'Ephemeral element ref from the latest observation.' });

const ExpectationSchema = Type.Object({
  urlIncludes: Type.Optional(Type.String()),
  titleIncludes: Type.Optional(Type.String()),
  textIncludes: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  state: Type.Optional(Type.Union([Type.Literal('visible'), Type.Literal('hidden')])),
}, { additionalProperties: false });
const Expectation = Type.Optional(ExpectationSchema);

function action<T extends string, P extends Record<string, TSchema>>(name: T, properties: P) {
  return Type.Object({
    action: Type.Literal(name),
    sessionId: SessionId,
    approvalId: ApprovalId,
    ...properties,
  }, { additionalProperties: false });
}

const Observe = action('observe', {
  visual: Type.Optional(Type.Union([Type.Literal('never'), Type.Literal('auto'), Type.Literal('always')])),
});
const Navigate = action('navigate', { url: Type.String({ minLength: 1 }), expect: Expectation });
const Click = action('click', { revision: Revision, ref: Ref, expect: Expectation });
const Fill = action('fill', {
  revision: Revision,
  ref: Ref,
  value: Type.String(),
  submit: Type.Optional(Type.Boolean()),
  expect: Expectation,
});
const Select = action('select', { revision: Revision, ref: Ref, value: Type.String(), expect: Expectation });
const Press = action('press', {
  revision: Revision,
  ref: Type.Optional(Ref),
  key: Type.String({ minLength: 1 }),
  expect: Expectation,
});
const Scroll = action('scroll', {
  revision: Revision,
  ref: Type.Optional(Ref),
  deltaY: Type.Number(),
  expect: Expectation,
});
const Wait = action('wait', {
  revision: Revision,
  condition: Type.Union([
    Type.Literal('page_idle'),
    Type.Literal('text'),
    Type.Literal('visible'),
    Type.Literal('hidden'),
  ]),
  value: Type.Optional(Type.String()),
  ref: Type.Optional(Ref),
  timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 120_000 })),
});
const Upload = action('upload', {
  revision: Revision,
  ref: Ref,
  paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20 }),
  expect: Expectation,
});
const Tabs = action('tabs', {
  operation: Type.Union([Type.Literal('list'), Type.Literal('create'), Type.Literal('activate'), Type.Literal('close')]),
  tabId: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
});

const SequenceStep = Type.Union([
  Type.Object({ action: Type.Literal('click'), ref: Ref, expect: Expectation }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('fill'), ref: Ref, value: Type.String(), submit: Type.Optional(Type.Boolean()), expect: Expectation }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('select'), ref: Ref, value: Type.String(), expect: Expectation }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('press'), ref: Type.Optional(Ref), key: Type.String(), expect: Expectation }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('scroll'), ref: Type.Optional(Ref), deltaY: Type.Number(), expect: Expectation }, { additionalProperties: false }),
]);
const Sequence = action('sequence', {
  revision: Revision,
  steps: Type.Array(SequenceStep, { minItems: 1, maxItems: 10 }),
  expect: Expectation,
});
const Close = action('close', {});

export const BrowserUseActionSchema = Type.Union([
  Observe,
  Navigate,
  Click,
  Fill,
  Select,
  Press,
  Scroll,
  Wait,
  Upload,
  Tabs,
  Sequence,
  Close,
]);

// Function-calling providers require a top-level object schema. Keep the
// discriminated union above for exact runtime validation and expose this
// bounded object shape to the model.
export const BrowserUseSchema = Type.Object({
  action: Type.Union([
    Type.Literal('observe'),
    Type.Literal('navigate'),
    Type.Literal('click'),
    Type.Literal('fill'),
    Type.Literal('select'),
    Type.Literal('press'),
    Type.Literal('scroll'),
    Type.Literal('wait'),
    Type.Literal('upload'),
    Type.Literal('tabs'),
    Type.Literal('sequence'),
    Type.Literal('close'),
  ]),
  sessionId: SessionId,
  approvalId: ApprovalId,
  revision: Type.Optional(Revision),
  ref: Type.Optional(Ref),
  expect: Type.Optional(ExpectationSchema),
  visual: Type.Optional(Type.Union([Type.Literal('never'), Type.Literal('auto'), Type.Literal('always')])),
  url: Type.Optional(Type.String({ minLength: 1 })),
  value: Type.Optional(Type.String()),
  submit: Type.Optional(Type.Boolean()),
  key: Type.Optional(Type.String({ minLength: 1 })),
  deltaY: Type.Optional(Type.Number()),
  condition: Type.Optional(Type.Union([
    Type.Literal('page_idle'),
    Type.Literal('text'),
    Type.Literal('visible'),
    Type.Literal('hidden'),
  ])),
  timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 120_000 })),
  paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20 })),
  operation: Type.Optional(Type.Union([
    Type.Literal('list'),
    Type.Literal('create'),
    Type.Literal('activate'),
    Type.Literal('close'),
  ])),
  tabId: Type.Optional(Type.String()),
  steps: Type.Optional(Type.Array(SequenceStep, { minItems: 1, maxItems: 10 })),
}, { additionalProperties: false });

export type BrowserUseInput = Static<typeof BrowserUseSchema>;

const ACTION_FIELDS = {
  observe: ['visual'],
  navigate: ['url', 'expect'],
  click: ['revision', 'ref', 'expect'],
  fill: ['revision', 'ref', 'value', 'submit', 'expect'],
  select: ['revision', 'ref', 'value', 'expect'],
  press: ['revision', 'ref', 'key', 'expect'],
  scroll: ['revision', 'ref', 'deltaY', 'expect'],
  wait: ['revision', 'condition', 'value', 'ref', 'timeoutMs'],
  upload: ['revision', 'ref', 'paths', 'expect'],
  tabs: ['operation', 'tabId', 'url'],
  sequence: ['revision', 'steps', 'expect'],
  close: [],
} as const;

const SEQUENCE_STEP_FIELDS = {
  click: ['ref', 'expect'],
  fill: ['ref', 'value', 'submit', 'expect'],
  select: ['ref', 'value', 'expect'],
  press: ['ref', 'key', 'expect'],
  scroll: ['ref', 'deltaY', 'expect'],
} as const;

type BrowserActionName = keyof typeof ACTION_FIELDS;
type SequenceActionName = keyof typeof SEQUENCE_STEP_FIELDS;

/** Decode the provider-facing superset into one exact Browser Control action. */
export function decodeBrowserUseInput(value: unknown): BrowserActionInput | null {
  if (!isRecord(value) || !isBrowserActionName(value.action)) return null;

  const candidate: Record<string, unknown> = { action: value.action };
  copyNonEmptyString(value, candidate, 'sessionId');
  copyNonEmptyString(value, candidate, 'approvalId');

  for (const field of ACTION_FIELDS[value.action]) {
    const fieldValue = value[field];
    if (fieldValue === undefined || fieldValue === null) continue;
    if (field === 'expect') {
      const expectation = decodeExpectation(fieldValue);
      if (expectation) candidate.expect = expectation;
    } else if (field === 'steps') {
      if (!Array.isArray(fieldValue)) {
        candidate.steps = fieldValue;
        continue;
      }
      const steps = fieldValue.map(decodeSequenceStep);
      if (steps.some((step) => step === null)) return null;
      candidate.steps = steps;
    } else if ((field === 'ref' || field === 'tabId' || field === 'url') && fieldValue === '') {
      continue;
    } else {
      candidate[field] = fieldValue;
    }
  }

  return Value.Check(BrowserUseActionSchema, candidate)
    ? candidate as BrowserActionInput
    : null;
}

function decodeSequenceStep(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isSequenceActionName(value.action)) return null;
  const candidate: Record<string, unknown> = { action: value.action };
  for (const field of SEQUENCE_STEP_FIELDS[value.action]) {
    const fieldValue = value[field];
    if (fieldValue === undefined || fieldValue === null) continue;
    if (field === 'expect') {
      const expectation = decodeExpectation(fieldValue);
      if (expectation) candidate.expect = expectation;
    } else if (field === 'ref' && fieldValue === '') {
      continue;
    } else {
      candidate[field] = fieldValue;
    }
  }
  return candidate;
}

function decodeExpectation(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const expectation: Record<string, unknown> = {};
  for (const field of ['urlIncludes', 'titleIncludes', 'textIncludes', 'ref'] as const) {
    copyNonEmptyString(value, expectation, field);
  }
  if (expectation.ref && (value.state === 'visible' || value.state === 'hidden')) {
    expectation.state = value.state;
  }
  return Object.keys(expectation).length > 0 ? expectation : null;
}

function copyNonEmptyString(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  field: string,
): void {
  const value = source[field];
  if (typeof value === 'string' && value.length > 0) target[field] = value;
}

function isBrowserActionName(value: unknown): value is BrowserActionName {
  return typeof value === 'string' && Object.hasOwn(ACTION_FIELDS, value);
}

function isSequenceActionName(value: unknown): value is SequenceActionName {
  return typeof value === 'string' && Object.hasOwn(SEQUENCE_STEP_FIELDS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
