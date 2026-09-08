import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import type { ClarifyRequestPayload, GatewayClarifyRequestFn } from './clarify-tool.js';

/**
 * stdin/stdout prompts for `clarify` when running the CLI agent (no gateway).
 */
export function createCliReadlineClarifyRequestFn(): GatewayClarifyRequestFn {
  return async (_context, req: ClarifyRequestPayload) => {
    const rl = readline.createInterface({ input, output });

    try {
      const choices = req.choices;
      if (choices && choices.length >= 2) {
        output.write(`\n${req.question}\n`);
        choices.forEach((c, i) => output.write(`  ${i + 1}) ${c}\n`));
        if (req.suggestedAnswer) {
          output.write(`  (recommended: ${req.suggestedAnswer})\n`);
        }
        const raw = (await rl.question('Choice (number or exact text): ')).trim();
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= choices.length) {
          return { status: 'answered', answer: choices[n - 1]! };
        }
        if (raw) return { status: 'answered', answer: raw };
        if (req.suggestedAnswer) return { status: 'answered', answer: req.suggestedAnswer };
        throw new Error('No answer provided');
      }

      output.write(`\n${req.question}\n`);
      if (req.suggestedAnswer) {
        output.write(`(Press Enter for recommendation: ${req.suggestedAnswer})\n`);
      }
      const raw = (await rl.question('> ')).trim();
      if (raw) return { status: 'answered', answer: raw };
      if (req.suggestedAnswer) return { status: 'answered', answer: req.suggestedAnswer };
      throw new Error('No answer provided');
    } finally {
      rl.close();
    }
  };
}
