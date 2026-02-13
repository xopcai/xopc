export interface Attachment {
  name: string;
  type: string;
  content: string;
}

export function loadAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type,
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
