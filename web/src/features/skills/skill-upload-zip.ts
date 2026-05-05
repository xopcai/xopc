export async function fileToZipUpload(file: File): Promise<File> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.zip')) return file;
  if (lower.endsWith('skill.md')) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('SKILL.md', await file.arrayBuffer());
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const base = file.name.replace(/\.md$/i, '').replace(/\s+/g, '-') || 'skill';
    return new File([blob], `${base}.zip`, { type: 'application/zip' });
  }
  throw new Error('invalid');
}
