import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { Image, View, type ImageProps, type ImageURISource } from 'react-native';
import { fetchGatewayAsset, gatewayAssetPath } from '../api/gateway-assets';
import { useGatewayStore } from '../stores/gateway-store';

const attached = new WeakSet<QueryClient>();
function removeFile(uri: string): void {
  try { new File(uri).delete(); } catch { /* Already removed by the OS cache cleaner. */ }
}
function ownCachedFiles(client: QueryClient): void {
  if (attached.has(client)) return;
  attached.add(client);
  const files = new Map<string, string>();
  client.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] !== 'private-gateway-image') return;
    const previous = files.get(event.query.queryHash);
    const next = event.query.state.data;
    if (previous && (event.type === 'removed' || (typeof next === 'string' && next !== previous))) removeFile(previous);
    if (event.type === 'removed') files.delete(event.query.queryHash);
    else if (typeof next === 'string') files.set(event.query.queryHash, next);
  });
}

/** Native image loaders never receive Gateway credentials or follow credential-bearing redirects. */
export function GatewayImage({ source, onFetchError, ...props }: ImageProps & { onFetchError?: (error: Error) => void }) {
  const client = useQueryClient();
  useEffect(() => { ownCachedFiles(client); }, [client]);
  const gatewayId = useGatewayStore((state) => state.activeGatewayId);
  const generation = useGatewayStore((state) => state.connectionGeneration);
  const candidate = typeof source === 'object' && !Array.isArray(source) ? source as ImageURISource : undefined;
  const uri = candidate?.uri;
  let privatePath: string | null = null;
  if (uri?.startsWith('https://')) privatePath = gatewayAssetPath(uri);
  const query = useQuery({
    queryKey: ['private-gateway-image', gatewayId, generation, uri],
    enabled: Boolean(privatePath), staleTime: 60_000, gcTime: 60_000, retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetchGatewayAsset(uri!, signal);
      if (!response.ok || !response.body) throw new Error(`Image request failed: ${response.status}`);
      const directory = new Directory(Paths.cache, 'gateway-images');
      directory.create({ intermediates: true, idempotent: true });
      const file = new File(directory, randomUUID());
      file.create();
      try {
        let received = 0;
        const bounded = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > 100 * 1024 * 1024) throw new Error('Image exceeds 100 MiB');
            controller.enqueue(chunk);
          },
        });
        await response.body.pipeThrough(bounded).pipeTo(file.writableStream(), { signal });
        if (signal.aborted) throw new Error('Image request cancelled');
        return file.uri;
      } catch (error) { removeFile(file.uri); throw error; }
    },
  });
  useEffect(() => {
    if (privatePath && query.error) onFetchError?.(query.error);
  }, [privatePath, query.error, onFetchError]);
  if (privatePath) return query.data
    ? <Image {...props} source={{ uri: query.data }} />
    : <View style={props.style} />;
  // Public/third-party images must not inherit device Authorization headers.
  const sanitized = candidate ? { ...candidate, headers: undefined } : Array.isArray(source)
    ? source.map((item) => ({ ...item, headers: undefined })) : source;
  return <Image {...props} source={sanitized} />;
}
