export { MessageList } from './MessageList.js';
export { MessageEditor } from './MessageEditor.js';
export { StreamingMessageContainer } from './StreamingMessageContainer.js';

export interface Attachment {
  name: string;
  type: string;
  content: string;
}

export function isUserMessageWithAttachments(message: any): boolean {
  return message.role === 'user-with-attachments';
}

export function convertAttachments(message: any): Attachment[] {
  if (message.role === 'user-with-attachments' && message.attachments) {
    return message.attachments;
  }
  return [];
}
