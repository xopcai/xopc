/**
 * CLI stream renderer for agent events
 *
 * Consumes processDirectStreaming events and renders thinking,
 * tool calls, and response tokens to the terminal in real time.
 */

import type { AgentService } from '../../../agent/index.js';

/** Styled labels for terminal output */
const STYLE = {
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  magenta: '\x1b[35m',
};

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  const parts = entries.map(([key, value]) => {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const truncated = stringValue.length > 80 ? stringValue.slice(0, 77) + '...' : stringValue;
    return `${key}=${truncated}`;
  });
  return parts.join(', ');
}

/**
 * Consume the processDirectStreaming async generator and render
 * thinking / tool-call / response tokens to stdout.
 *
 * Returns the final aggregated response text.
 */
export async function renderStreamToTerminal(
  agent: AgentService,
  message: string,
  sessionKey: string,
): Promise<string> {
  const stream = agent.processDirectStreaming(message, sessionKey);

  let responseText = '';
  let isFirstToken = true;
  let isInThinking = false;
  let hasThinking = false;

  for await (const event of stream) {
    switch (event.type) {
      case 'thinking': {
        const content = event.content as string | undefined;
        const status = event.status as string | undefined;

        if (status === 'started') {
          // Thinking phase started
          isInThinking = true;
          hasThinking = true;
          process.stdout.write(`\n${STYLE.dim}${STYLE.magenta}💭 Thinking...${STYLE.reset}\n`);
          break;
        }

        if (content) {
          if (!hasThinking) {
            isInThinking = true;
            hasThinking = true;
            process.stdout.write(`\n${STYLE.dim}${STYLE.magenta}💭 Thinking...${STYLE.reset}\n`);
          }
          process.stdout.write(`${STYLE.dim}${content}${STYLE.reset}`);
        }
        break;
      }

      case 'tool_start': {
        const toolName = event.toolName as string;
        const args = event.args;

        // Close thinking section if open
        if (isInThinking) {
          isInThinking = false;
          process.stdout.write('\n');
        }

        const argsStr = formatToolArgs(args);
        process.stdout.write(
          `\n${STYLE.cyan}🔧 Tool: ${STYLE.bold}${toolName}${STYLE.reset}` +
          (argsStr ? `${STYLE.dim} (${argsStr})${STYLE.reset}` : '') +
          '\n',
        );
        break;
      }

      case 'tool_end': {
        const toolName = event.toolName as string;
        const isError = event.isError as boolean;

        if (isError) {
          process.stdout.write(`${STYLE.red}   ✗ ${toolName} failed${STYLE.reset}\n`);
        } else {
          process.stdout.write(`${STYLE.green}   ✓ ${toolName} done${STYLE.reset}\n`);
        }
        break;
      }

      case 'token': {
        const content = event.content as string;
        if (!content) break;

        // Close thinking section if open
        if (isInThinking) {
          isInThinking = false;
          process.stdout.write('\n');
        }

        if (isFirstToken) {
          process.stdout.write('\n🤖: ');
          isFirstToken = false;
        }
        process.stdout.write(content);
        responseText += content;
        break;
      }

      case 'message_end': {
        // Ensure newline after streaming response
        if (!isFirstToken) {
          process.stdout.write('\n');
        }
        break;
      }

      case 'progress': {
        // Optionally show progress updates (e.g. "Thinking...")
        break;
      }

      default:
        break;
    }
  }

  // If no tokens were streamed, print empty line
  if (isFirstToken && !hasThinking) {
    process.stdout.write('\n🤖: (no response)\n');
  }

  return responseText;
}
