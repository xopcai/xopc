import { useEffect, useState } from 'react';

/** Create a blob object URL and revoke it on cleanup or when the blob changes. */
export function useBlobObjectUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  return url;
}
