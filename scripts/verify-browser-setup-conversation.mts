/** Current UI conversation + production Chrome native pairing and real model verification. */
process.env.XOPC_BROWSER_CONVERSATION_ONLY = '1';
process.env.XOPC_BROWSER_SETUP_CLOUD = '1';
await import('./verify-browser-setup-production.mts');
