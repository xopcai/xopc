import './thread-stream-bundle-shim.js';

// Load logger dependencies only after their bundled worker path is configured.
await import('./main.js');
