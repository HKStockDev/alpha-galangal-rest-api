export const LLM_CHAT_MESSAGE_ROLES = [
  'system',
  'user',
  'assistant',
  'tool',
] as const;
export type LlmChatMessageRole = (typeof LLM_CHAT_MESSAGE_ROLES)[number];
