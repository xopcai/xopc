import { useGeneratedMedia } from './use-generated-media';

export function GeneratedVideo({ src, title }: { src: string; title: string }) {
  const { hostRef } = useGeneratedMedia({ kind: 'video', src, title });
  return <div ref={hostRef} />;
}
