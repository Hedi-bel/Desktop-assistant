export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export const CHAT_HISTORY_LIMIT = 12;

export function trimReply(text: string): string {
  return text.trim();
}