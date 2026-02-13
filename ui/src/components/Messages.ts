export { MessageList } from './MessageList';
export { MessageEditor } from './MessageEditor';
export { StreamingMessageContainer } from './StreamingMessageContainer';

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
