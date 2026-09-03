import { parseFileResourceArtifactUri } from '@xopcai/gateway-contract';

export function artifactFileId(uri: string | undefined): string | null {
  return uri ? parseFileResourceArtifactUri(uri) : null;
}
