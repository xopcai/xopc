export interface Attachment {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  size: number;
  content: string; // base64
}

export function loadAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type.startsWith('image/') ? 'image' : 'document',
        mimeType: file.type,
        size: file.size,
        content: reader.result as string,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function getFileType(mimeType: string): 'image' | 'text' | 'other' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/') || mimeType.includes('json')) return 'text';
  return 'other';
}
