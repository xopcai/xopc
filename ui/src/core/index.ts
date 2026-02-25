/**
 * Core Module - Business logic and state management
 */

// Stores
export { createMessageStore, type MessageStore, type Message, type MessageActions } from './stores/message-store.js';

// Services
export { GatewayConnection, createConnection, type ConnectionState, type ConnectionConfig } from './services/connection.js';
export { createApiService, type ApiService, type SendMessageRequest, type ApiError } from './services/api.js';
