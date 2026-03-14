// ============================================
// Shared Constants for UI Components
// ============================================

// API Types for model providers
export const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
  { value: 'anthropic', label: 'Anthropic (Legacy)' },
  { value: 'openai', label: 'OpenAI (Legacy)' },
  { value: 'google', label: 'Google AI' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'groq', label: 'Groq' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'local', label: 'Local' },
] as const;

// Channel types
export const CHANNEL_TYPES = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'slack', label: 'Slack' },
  { value: 'irc', label: 'IRC' },
  { value: 'signal', label: 'Signal' },
  { value: 'gchat', label: 'Google Chat' },
] as const;

// Voice providers
export const VOICE_PROVIDERS = [
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'alibaba', label: 'Alibaba Cloud' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'google', label: 'Google Cloud' },
] as const;

// STT providers
export const STT_PROVIDERS = [
  { value: 'alibaba', label: 'Alibaba Cloud' },
  { value: 'openai', label: 'OpenAI Whisper' },
  { value: 'google', label: 'Google Cloud' },
] as const;

// Policy types for Telegram
export const DM_POLICY_OPTIONS = [
  { value: 'pairing', label: 'Pairing Required' },
  { value: 'allowlist', label: 'Allowlist Only' },
  { value: 'open', label: 'Open' },
  { value: 'disabled', label: 'Disabled' },
] as const;

export const GROUP_POLICY_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'allowlist', label: 'Allowlist Only' },
  { value: 'disabled', label: 'Disabled' },
] as const;

export const STREAM_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'partial', label: 'Partial' },
  { value: 'block', label: 'Block' },
] as const;

export const REPLY_MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'first', label: 'Reply to First' },
  { value: 'all', label: 'Reply to All' },
] as const;

// Thinking levels
export const THINKING_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

// Theme options
export const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

// Language options
export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
] as const;

// Default values
export const DEFAULT_SETTINGS = {
  maxTokens: 4096,
  temperature: 0.7,
  maxToolIterations: 100,
  historyLimit: 100,
  textChunkLimit: 4000,
} as const;
