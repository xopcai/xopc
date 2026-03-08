/**
 * Session listing for agent command
 */

import { getSessionManager } from '../../utils/session.js';

/**
 * List available sessions in a table format
 */
export async function listSessions(workspace: string): Promise<void> {
  const manager = await getSessionManager(workspace);
  
  const result = await manager.listSessions({ limit: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
  
  console.log('\n📋 Available Sessions:\n');
  if (result.items.length === 0) {
    console.log('No sessions found.');
    return;
  }
  
  console.log('Key'.padEnd(35) + 'Name'.padEnd(20) + 'Messages'.padEnd(10) + 'Updated');
  console.log('─'.repeat(85));
  
  for (const session of result.items) {
    const name = (session.name || '-').slice(0, 18).padEnd(20);
    const messages = String(session.messageCount).padEnd(10);
    const updated = new Date(session.updatedAt).toLocaleDateString();
    console.log(`${session.key.slice(0, 33).padEnd(35)}${name}${messages}${updated}`);
  }
  console.log();
}
