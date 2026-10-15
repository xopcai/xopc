import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { normalizeClarificationSubmission } from '@xopcai/gateway-contract';
import type { GatewayClarifyRequestFn } from './clarify-tool.js';

export function createCliReadlineClarifyRequestFn(): GatewayClarifyRequestFn {
  return async (_context, request) => {
    const rl = readline.createInterface({ input, output });
    try {
      output.write(`\n${request.question}\n`);
      if (request.kind === 'approval') {
        output.write(`${JSON.stringify(request.approval)}\n`);
        const decision = (await rl.question('Type approve or deny: ')).trim();
        return { status: 'answered', answer: normalizeClarificationSubmission(request, { decision }).answer };
      }
      request.choiceDetails?.forEach((choice, index) => output.write(`  ${index + 1}) ${choice.label}${choice.description ? ` — ${choice.description}` : ''}${choice.id === request.recommendedChoiceId ? ' (recommended)' : ''}\n`));
      const raw = (await rl.question('Choice number or your answer: ')).trim();
      const choice = /^\d+$/.test(raw) ? request.choiceDetails?.[Number(raw) - 1] : undefined;
      const text = choice && request.interactionMode === 'compose' ? (await rl.question('Additional information (optional): ')).trim() : choice ? undefined : raw;
      return { status: 'answered', answer: normalizeClarificationSubmission(request, { response: { choiceId: choice?.id, text } }).answer };
    } finally { rl.close(); }
  };
}
