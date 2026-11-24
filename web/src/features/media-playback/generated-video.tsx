import { useGeneratedMedia } from './use-generated-media';

export function GeneratedVideo({ src, title, className }: { src: string; title: string; className?: string }) {
  const { hostRef } = useGeneratedMedia({ kind: 'video', src, title });
  return <div ref={hostRef} className={className} />;
}
