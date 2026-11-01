import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { durableEndpointResultSchema, endpointToolDescriptorSchema, type EndpointToolDescriptor } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

/** Trusted bundled descriptors, validated locally as well as at the Gateway. */
export class DesktopExecutionCatalog {
  private readonly tools = new Map<string, { descriptor: EndpointToolDescriptor; revision: string; input: ValidateFunction; output: ValidateFunction }>();
  constructor(descriptors: readonly EndpointToolDescriptor[]) {
    if (descriptors.length > 100) throw new Error('DESKTOP_RELIABLE_DESCRIPTOR_INVALID');
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addFormat('uri', { type: 'string', validate: value => z.url().safeParse(value).success });
    for (const input of descriptors) {
      const descriptor = endpointToolDescriptorSchema.parse(JSON.parse(JSON.stringify(input)));
      if (this.tools.has(descriptor.name) || descriptor.effect === 'read' || descriptor.confirmation !== 'always'
        || !descriptor.requiresForeground || descriptor.maxConcurrency !== 1 || !descriptor.supportsCancellation) throw new Error('DESKTOP_RELIABLE_DESCRIPTOR_INVALID');
      this.tools.set(descriptor.name, { descriptor, revision: endpointToolRevision(descriptor), input: ajv.compile(descriptor.inputSchema), output: ajv.compile(descriptor.outputSchema) });
    }
  }
  revision(tool: string): string | undefined { return this.tools.get(tool)?.revision; }
  deadlineAllowed(tool: string, deadline: number, now = Date.now()): boolean {
    const timeout = this.tools.get(tool)?.descriptor.timeoutMs;
    return timeout !== undefined && deadline > now && deadline - now <= timeout;
  }
  descriptors(): EndpointToolDescriptor[] { return [...this.tools.values()].map(tool => structuredClone(tool.descriptor)); }
  validateArguments(tool: string, args: Record<string, unknown>): void {
    if (!this.tools.get(tool)?.input(args)) throw new Error('DESKTOP_EXECUTION_ARGUMENT_INVALID');
  }
  readonly validateResult = (result: unknown, tool: string): unknown => {
    const parsed = durableEndpointResultSchema.parse(result);
    if (!this.tools.get(tool)?.output(parsed.content)) throw new Error('DESKTOP_EXECUTION_RESULT_INVALID');
    return parsed;
  };
}
