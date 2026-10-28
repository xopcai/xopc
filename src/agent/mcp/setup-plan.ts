import { z } from 'zod';

const field = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), label: z.string().min(1).max(80),
  location: z.enum(['header', 'env']), name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),
  prefix: z.enum(['', 'Bearer ']).default(''),
}).strict().superRefine((value, ctx) => {
  if (value.location === 'header' && /^(host|cookie|set-cookie|connection|content-length|transfer-encoding|upgrade|origin|referer|proxy-.*|sec-.*|x-forwarded-.*)$/i.test(value.name)) ctx.addIssue({ code: 'custom', message: 'This header cannot carry a setup credential' });
  if (value.location === 'env' && /^(PATH|HOME|NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|PYTHONPATH|BASH_ENV|ENV|COMSPEC|SHELL)$/i.test(value.name)) ctx.addIssue({ code: 'custom', message: 'This environment variable cannot be supplied by a connection plan' });
});
export const secretFieldsSchema = z.array(field).max(8).superRefine((values, ctx) => {
  if (new Set(values.map(v => v.id)).size !== values.length || new Set(values.map(v => `${v.location}:${v.name.toLowerCase()}`)).size !== values.length) ctx.addIssue({ code: 'custom', message: 'Credential fields must be unique' });
});
export type SetupSecretField = z.infer<typeof field>;
export const localExecutionSchema = z.object({
  command: z.string().min(1).max(1024), args: z.array(z.string().max(2048)).max(40).default([]),
  cwd: z.string().min(1).max(2048).optional(), sourceUrl: z.string().url().max(2048),
}).strict().superRefine((value, ctx) => {
  if (/[\r\n\0]/.test([value.command, ...value.args, value.cwd ?? ''].join('')) || /[\r\n\0]/.test(value.command) || /^(sh|bash|zsh|cmd|powershell|pwsh)(\.exe)?$/i.test(value.command.split(/[\\/]/).at(-1)!)) ctx.addIssue({ code: 'custom', message: 'Use a concrete executable without a shell' });
  if (value.args.some(arg => /(?:^|[?&])(?:token|password|secret|api[-_]?key)=|^--(?:token|password|secret|api[-_]?key)(?:=|$)/i.test(arg))) ctx.addIssue({ code: 'custom', message: 'Put credentials in secure environment fields, never arguments' });
  if (/^(npx|npm|pnpm|yarn)(\.cmd)?$/i.test(value.command.split(/[\\/]/).at(-1)!)) {
    const packages = value.args.filter(arg => !arg.startsWith('-') && !['exec', 'dlx', 'run'].includes(arg));
    if (!packages.length || packages.some(arg => !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+@\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(arg))) ctx.addIssue({ code: 'custom', message: 'Package execution requires an exact package version and no extra command arguments' });
  }
});
export type LocalExecution = z.infer<typeof localExecutionSchema>;
export const connectionPlanSchema = z.object({
  displayName: z.string().min(1).max(100), url: z.string().url().max(2048).optional(),
  transport: z.enum(['streamable-http', 'sse', 'stdio']).default('streamable-http'),
  authentication: z.enum(['auto', 'bearer', 'header', 'none']).default('auto'),
  secretFields: secretFieldsSchema.default([]), helpUrl: z.string().url().max(2048).optional(),
  execution: localExecutionSchema.optional(), objective: z.enum(['connect_only', 'complete_task']),
}).strict().superRefine((value, ctx) => {
  if (value.transport === 'stdio' ? !value.execution || value.url : !value.url || value.execution) ctx.addIssue({ code: 'custom', message: 'Provide an HTTP URL or a concrete stdio execution plan' });
  if (value.secretFields.some(f => f.location !== (value.transport === 'stdio' ? 'env' : 'header'))) ctx.addIssue({ code: 'custom', message: 'Credential fields do not match the transport' });
  if (value.authentication === 'header' && !value.secretFields.length) ctx.addIssue({ code: 'custom', message: 'Header authentication needs documented secret fields' });
  if (value.authentication === 'bearer' && value.secretFields.length) {
    if (value.secretFields.length !== 1 || value.secretFields[0].location !== 'header' || value.secretFields[0].name.toLowerCase() !== 'authorization') ctx.addIssue({ code: 'custom', message: 'Bearer authentication uses one Authorization credential field' });
    else value.secretFields[0].prefix = 'Bearer ';
  }
});
export type ConnectionPlan = z.infer<typeof connectionPlanSchema>;
