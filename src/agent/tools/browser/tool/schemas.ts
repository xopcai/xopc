import { Type, type Static, type TSchema } from '@sinclair/typebox';

const ApprovalId = Type.Optional(Type.String({ description: 'One-time local-owner approval id for this exact action.' }));
const SessionId = Type.Optional(Type.String({ description: 'Browser session id returned by the previous observation.' }));
const Revision = Type.Number({ description: 'Observation revision used to resolve element refs.' });
const Ref = Type.String({ description: 'Ephemeral element ref from the latest observation.' });

const Expectation = Type.Optional(Type.Object({
  urlIncludes: Type.Optional(Type.String()),
  titleIncludes: Type.Optional(Type.String()),
  textIncludes: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  state: Type.Optional(Type.Union([Type.Literal('visible'), Type.Literal('hidden')])),
}, { additionalProperties: false }));

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

export const BrowserUseSchema = Type.Union([
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

export type BrowserUseInput = Static<typeof BrowserUseSchema>;
