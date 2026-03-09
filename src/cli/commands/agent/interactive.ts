/**
 * Interactive chat mode for agent command
 */

import type { Interface as _Interface } from 'readline';
import type { AgentService } from '../../../agent/index.js';
import { getSessionManager } from '../../utils/session.js';
import { listSessions } from './sessions.js';

export interface InteractiveOptions {
  workspace: string;
  sessionKey: string;
  continuingSession: boolean;
}

/**
 * Start interactive chat mode
 */
export async function startInteractiveChat(
  agent: AgentService,
  options: InteractiveOptions
): Promise<void> {
  const { workspace, sessionKey: initialSessionKey, continuingSession } = options;
  
  let sessionKey = initialSessionKey;

  if (continuingSession) {
    console.log('🧠 Interactive chat mode - Continuing session\n');
  } else {
    console.log('🧠 Interactive chat mode (Ctrl+C to exit)\n');
  }

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.on('line', async (input) => {
    const trimmed = input.trim();
    
    // Handle special commands
    if (trimmed === ':sessions' || trimmed === ':list') {
      rl.pause();
      await listSessions(workspace);
      rl.resume();
      rl.prompt();
      return;
    }
    
    if (trimmed.startsWith(':session ')) {
      const newSessionKey = trimmed.slice(9).trim();
      const manager = await getSessionManager(workspace);
      const session = await manager.getSessionMetadata(newSessionKey);
      if (session) {
        sessionKey = newSessionKey;
        console.log(`🔄 Switched to session: ${sessionKey}\n`);
      } else {
        console.log(`❌ Session not found: ${newSessionKey}\n`);
      }
      rl.prompt();
      return;
    }

    if (trimmed === ':help') {
      printHelp();
      rl.prompt();
      return;
    }

    if (trimmed === ':quit' || trimmed === ':exit') {
      rl.close();
      return;
    }

    const response = await agent.processDirect(input, sessionKey);
    console.log('\n🤖:', response);
    rl.prompt();
  });

  rl.on('close', async () => {
    console.log('\n👋 Goodbye!');
    process.exit(0);
  });

  rl.setPrompt('You: ');
  rl.prompt();
}

function printHelp(): void {
  console.log(`
📖 Available commands:
  :sessions, :list    - List available sessions
  :session <key>     - Switch to another session
  :quit, :exit       - Exit interactive mode
  :help              - Show this help
`);
}
